package com.shyden.shytalk.feature.messaging

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.model.ConversationSettings
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.ModerationFilter
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.effectiveCohort
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class ConversationWithUser(
    val conversation: Conversation,
    val otherUser: User? = null,
    val settings: ConversationSettings? = null,
    val isBlocked: Boolean = false,
    val isGroup: Boolean = false,
    val groupName: String? = null,
    val groupPhotoUrl: String? = null,
)

data class ConversationListUiState(
    val conversations: List<ConversationWithUser> = emptyList(),
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val error: String? = null,
    val totalUnreadCount: Long = 0,
    val searchQuery: String = "",
    val aliases: Map<String, String> = emptyMap(),
)

class ConversationListViewModel(
    private val pmRepository: PrivateMessageRepository,
    private val userRepository: UserRepository,
    private val authRepository: AuthRepository,
) : ViewModel() {
    companion object {
        private const val TAG = "ConversationListViewModel"
    }

    private val _uiState = MutableStateFlow(ConversationListUiState())
    val uiState: StateFlow<ConversationListUiState> = _uiState.asStateFlow()

    val currentUserId: String = authRepository.currentUserId ?: ""

    // Cache for user data and settings to avoid refetching every time
    private val userCache = mutableMapOf<String, User>()
    private val settingsCache = mutableMapOf<String, ConversationSettings>()

    init {
        if (currentUserId.isNotEmpty()) {
            logI(TAG, "Initializing for user=$currentUserId")
            observeConversations()
            loadModerationConfig()
            loadAliases()
        } else {
            logW(TAG, "No current user, skipping initialization")
        }
    }

    private fun loadAliases() {
        viewModelScope.launch {
            when (val result = userRepository.getAliases(currentUserId)) {
                is Resource.Success -> _uiState.update { it.copy(aliases = result.data) }
                is Resource.Error -> logW(TAG, "Failed to load aliases: ${result.message}")
                is Resource.Loading -> Unit
            }
        }
    }

    private fun loadModerationConfig() {
        viewModelScope.launch {
            val result = pmRepository.getModerationConfig()
            if (result is Resource.Success) ModerationFilter.updateProhibitedWords(result.data)
        }
    }

    private var conversationsJob: kotlinx.coroutines.Job? = null

    private fun observeConversations() {
        conversationsJob?.cancel()
        conversationsJob =
            viewModelScope.launch {
                pmRepository
                    .getConversations(currentUserId)
                    .catch { e ->
                        logE(TAG, "Conversation observation failed: ${e.message}")
                        _uiState.update {
                            it.copy(isLoading = false, error = e.message ?: "Failed to load conversations")
                        }
                    }.collect { conversations ->
                        logI(TAG, "Received ${conversations.size} conversations")
                        loadConversationDetails(conversations)
                    }
            }
    }

    private suspend fun loadConversationDetails(conversations: List<Conversation>) {
        // Get current user's doc — needed for both blocked-list AND
        // pmLocked checks. Failure is regulatory-boundary critical.
        // We treat Resource.Error AND Resource.Loading identically as
        // "could not verify" — Loading shouldn't be observable from a
        // suspend `getUser`, but pinning it explicitly avoids future
        // surprises if the repository is rewritten to streaming.
        val userResult = userRepository.getUser(currentUserId)
        val currentUser =
            when (userResult) {
                is Resource.Success -> userResult.data
                is Resource.Error -> null
                is Resource.Loading -> null
            }

        // Fail-CLOSED if we can't verify pmLocked state (PR 11 / Apple
        // guideline 1.1.4). A transient Firestore error must NOT leak
        // PM threads to a possibly-locked account. Bumped from logW to
        // logE because this is a regulatory boundary failure that
        // ops/Sentry must surface, not a routine warning.
        if (currentUser == null) {
            logE(TAG, "PM-lock fail-closed: getUser failed for $currentUserId")
            _uiState.update { it.copy(isLoading = false, conversations = emptyList(), totalUnreadCount = 0L) }
            return
        }

        // Sub-18 (currentUser PM-locked): emit an empty list and skip
        // counterparty fetches. PR 11 — minors cannot see PM threads
        // at all; even surfacing a conversation summary would leak the
        // counterparty's identity to a locked account.
        if (currentUser.pmLocked) {
            _uiState.update { it.copy(isLoading = false, conversations = emptyList(), totalUnreadCount = 0L) }
            return
        }
        val blockedByMe = currentUser.blockedUserIds

        // Collect other user IDs we need to fetch (for 1-on-1 only)
        val otherUserIds = conversations.filter { !it.isGroup }.mapNotNull { it.otherUserId(currentUserId) }
        val uncachedIds = otherUserIds.filter { it !in userCache }

        // Batch fetch uncached users
        if (uncachedIds.isNotEmpty()) {
            when (val result = userRepository.getUsers(uncachedIds)) {
                is Resource.Success -> {
                    result.data.forEach { user -> userCache[user.uid] = user }
                }

                is Resource.Error -> {
                    logW(TAG, "Failed to batch-fetch users: ${result.message}")
                }

                else -> Unit
            }
        }

        // Populate settings cache from inline settings (returned by the list endpoint)
        for (conversation in conversations) {
            conversation.settings?.let { settingsCache[conversation.conversationId] = it }
        }

        // Show conversations with inline settings — no background refresh needed
        val conversationsWithDetails = buildConversationList(conversations, blockedByMe, currentUser)
        emitSortedConversations(conversationsWithDetails)
    }

    @Suppress("kotlin:S3776")
    private fun buildConversationList(
        conversations: List<Conversation>,
        blockedByMe: Set<String>,
        currentUser: User,
    ): List<ConversationWithUser> {
        val viewerCohort = currentUser.effectiveCohort
        return conversations.mapNotNull { conversation ->
            val settings = settingsCache[conversation.conversationId]

            // Filter hidden conversations (unless a new message arrived after hiding)
            if (settings?.isHidden == true) {
                val hiddenAt = settings.hiddenAt ?: 0
                if (conversation.lastMessageAt <= hiddenAt) return@mapNotNull null
            }

            if (conversation.isGroup) {
                // Skip closed groups
                if (conversation.isClosed) return@mapNotNull null
                ConversationWithUser(
                    conversation = conversation,
                    otherUser = null,
                    settings = settings,
                    isBlocked = false,
                    isGroup = true,
                    groupName = conversation.groupName,
                    groupPhotoUrl = conversation.groupPhotoUrl,
                )
            } else {
                // UK OSA #17 PR 12 — drop migration-frozen 1:1 threads.
                // PR 8 set frozenAtMigration on cross-cohort 1:1 threads
                // at the regulatory rollout; the comment on Conversation
                // states the KMP filter lands in PR 12 (this PR).
                if (conversation.frozenAtMigration) return@mapNotNull null

                val otherUserId = conversation.otherUserId(currentUserId) ?: return@mapNotNull null
                val otherUser = userCache[otherUserId]

                // Skip blocking + cohort checks for the system user — system
                // notifications must reach every account regardless of cohort.
                val isSystemConversation = otherUserId == Constants.SYSTEM_USER_ID
                if (!isSystemConversation) {
                    val blockedByTarget = otherUser?.blockedUserIds?.contains(currentUserId) == true
                    val isBlocked = otherUserId in blockedByMe || blockedByTarget
                    if (isBlocked) return@mapNotNull null

                    // Defence-in-depth: drop any cross-cohort 1:1 thread
                    // that escaped the PR 8 migration (stale offline cache
                    // / deep-link / age-up after thread was cached).
                    if (otherUser != null && otherUser.effectiveCohort != viewerCohort) {
                        return@mapNotNull null
                    }
                }

                ConversationWithUser(
                    conversation = conversation,
                    otherUser = otherUser,
                    settings = settings,
                    isBlocked = false,
                )
            }
        }
    }

    private fun emitSortedConversations(list: List<ConversationWithUser>) {
        val sorted =
            list.sortedWith(
                compareByDescending<ConversationWithUser> {
                    it.conversation.otherUserId(currentUserId) == Constants.SYSTEM_USER_ID
                }.thenByDescending { it.settings?.isPinned == true }
                    .thenByDescending { it.conversation.lastMessageAt },
            )

        val totalUnread =
            sorted
                .filter { it.settings?.isMuted != true }
                .sumOf { it.settings?.unreadCount ?: 0 }

        _uiState.update {
            it.copy(
                conversations = sorted,
                isLoading = false,
                totalUnreadCount = totalUnread,
            )
        }
    }

    fun onSearchQueryChanged(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
    }

    fun getFilteredConversations(): List<ConversationWithUser> {
        val query = _uiState.value.searchQuery
        val conversations = _uiState.value.conversations
        return if (query.isBlank()) {
            conversations
        } else {
            conversations.filter { cw ->
                if (cw.isGroup) {
                    cw.groupName?.contains(query, ignoreCase = true) == true
                } else {
                    cw.otherUser?.displayName?.contains(query, ignoreCase = true) == true
                }
            }
        }
    }

    fun hideConversation(conversationId: String) {
        logI(TAG, "Hiding conversation: $conversationId")
        viewModelScope.launch {
            pmRepository.hideConversation(conversationId, currentUserId)
            // Update cache so it's filtered out immediately
            settingsCache[conversationId] =
                (settingsCache[conversationId] ?: ConversationSettings(userId = currentUserId))
                    .copy(
                        isHidden = true,
                        hiddenAt =
                            com.shyden.shytalk.core.util
                                .currentTimeMillis(),
                    )
            // Remove from UI
            _uiState.update { state ->
                state.copy(
                    conversations = state.conversations.filter { it.conversation.conversationId != conversationId },
                )
            }
        }
    }

    fun pinConversation(conversationId: String) {
        viewModelScope.launch {
            val current = settingsCache[conversationId]
            val newPinned = !(current?.isPinned ?: false)
            pmRepository.pinConversation(conversationId, currentUserId, newPinned)
            settingsCache[conversationId] =
                (current ?: ConversationSettings(userId = currentUserId))
                    .copy(isPinned = newPinned)
            // Re-sort
            _uiState.update { state ->
                val updated =
                    state.conversations
                        .map { cw ->
                            if (cw.conversation.conversationId == conversationId) {
                                cw.copy(settings = cw.settings?.copy(isPinned = newPinned))
                            } else {
                                cw
                            }
                        }.sortedWith(
                            compareByDescending<ConversationWithUser> { it.settings?.isPinned == true }
                                .thenByDescending { it.conversation.lastMessageAt },
                        )
                state.copy(conversations = updated)
            }
        }
    }

    fun markConversationRead(conversationId: String) {
        settingsCache[conversationId] =
            (settingsCache[conversationId] ?: ConversationSettings(userId = currentUserId))
                .copy(unreadCount = 0)
        _uiState.update { state ->
            val updated =
                state.conversations.map { cw ->
                    if (cw.conversation.conversationId == conversationId) {
                        cw.copy(settings = cw.settings?.copy(unreadCount = 0))
                    } else {
                        cw
                    }
                }
            state.copy(
                conversations = updated,
                totalUnreadCount = updated.sumOf { it.settings?.unreadCount ?: 0 },
            )
        }
        // Persist to backend so re-fetches don't revert the local state
        viewModelScope.launch {
            pmRepository.resetUnreadCount(conversationId, currentUserId)
        }
    }

    fun refreshConversations() {
        logI(TAG, "Refreshing conversations")
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true) }
            userCache.clear()
            settingsCache.clear()
            observeConversations()
            kotlinx.coroutines.delay(500)
            _uiState.update { it.copy(isRefreshing = false) }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
