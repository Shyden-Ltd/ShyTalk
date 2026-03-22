package com.shyden.shytalk.feature.messaging

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.model.GroupPermissions
import com.shyden.shytalk.core.model.GroupRole
import com.shyden.shytalk.core.model.MessageEdit
import com.shyden.shytalk.core.model.MuteInfo
import com.shyden.shytalk.core.model.PmPrivacy
import com.shyden.shytalk.core.model.PrivateMessage
import com.shyden.shytalk.core.model.PrivateMessageType
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.SendStatus
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.ModerationFilter
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.compressImage
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.local.StickerStorage
import com.shyden.shytalk.data.remote.ConversationEvent
import com.shyden.shytalk.data.remote.ConversationWebSocketService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.data.repository.TranslationRepository
import com.shyden.shytalk.data.repository.TypingRepository
import com.shyden.shytalk.data.repository.UserRepository
import io.ktor.client.HttpClient
import io.ktor.client.request.get
import io.ktor.client.statement.bodyAsBytes
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class RoomInvitePreview(
    val room: ChatRoom,
    val seatUsers: Map<String, User>,
)

data class PrivateChatUiState(
    val messages: List<PrivateMessage> = emptyList(),
    val otherUser: User? = null,
    val currentUser: User? = null,
    val isLoading: Boolean = true,
    val error: String? = null,
    val isBlocked: Boolean = false,
    val blockReason: String? = null,
    val isMuted: Boolean = false,
    val isPinned: Boolean = false,
    val conversationId: String = "",
    val currentUserId: String = "",
    val currentUserName: String = "",
    val editingMessageId: String? = null,
    val editingOriginalText: String = "",
    val replyingToMessage: PrivateMessage? = null,
    val isLoadingOlder: Boolean = false,
    val hasOlderMessages: Boolean = true,
    val failedMessages: List<PrivateMessage> = emptyList(),
    val isOtherUserTyping: Boolean = false,
    val isUploadingImages: Boolean = false,
    val isSearching: Boolean = false,
    val searchQuery: String = "",
    val searchResults: List<PrivateMessage> = emptyList(),
    // Group chat fields
    val isGroup: Boolean = false,
    val conversationName: String = "",
    val groupParticipants: List<User> = emptyList(),
    val isAdmin: Boolean = false,
    val isModOrAbove: Boolean = false,
    val currentUserRole: GroupRole = GroupRole.MEMBER,
    val conversation: Conversation? = null,
    val currentUserMuteInfo: MuteInfo? = null,
    val groupMutes: List<MuteInfo> = emptyList(),
    // Sticker fields
    val showStickerPicker: Boolean = false,
    val stickers: List<Sticker> = emptyList(),
    val isSystemConversation: Boolean = false,
    val isRefreshing: Boolean = false,
    val aliases: Map<String, String> = emptyMap(),
    // Room invite preview data: roomId → (room, seatUsers)
    val roomInvites: Map<String, RoomInvitePreview> = emptyMap(),
    val translations: Map<String, String> = emptyMap(),
    val successMessage: String? = null,
)

class PrivateChatViewModel(
    private val otherUserId: String,
    private val pmRepository: PrivateMessageRepository,
    private val userRepository: UserRepository,
    private val authRepository: AuthRepository,
    private val typingRepository: TypingRepository,
    private val reportRepository: ReportRepository,
    private val storageRepository: StorageRepository =
        object : StorageRepository {
            override suspend fun uploadImage(
                userId: String,
                path: String,
                imageData: ByteArray,
                contentType: String,
            ): Resource<String> = Resource.Error("Not available")

            override suspend fun deleteImageByUrl(url: String) {}
        },
    private val stickerStorage: StickerStorage? = null,
    private val initialConversationId: String? = null,
    private val conversationWs: ConversationWebSocketService? = null,
    private val roomRepository: RoomRepository? = null,
    private val translationRepository: TranslationRepository? = null,
) : ViewModel() {
    companion object {
        private const val TAG = "PrivateChatViewModel"
    }

    private val _uiState = MutableStateFlow(PrivateChatUiState())
    val uiState: StateFlow<PrivateChatUiState> = _uiState.asStateFlow()

    private val currentUserId: String = authRepository.currentUserId ?: ""
    private var messagesJob: Job? = null
    private var settingsJob: Job? = null
    private var typingJob: Job? = null
    private var typingResetJob: Job? = null
    private var wsEventsJob: Job? = null
    private val olderMessages = mutableListOf<PrivateMessage>()
    private val pendingMessages = mutableMapOf<String, PrivateMessage>()
    private var lazyHttpClient: HttpClient? = null
    private val httpClient: HttpClient
        get() = lazyHttpClient ?: HttpClient().also { lazyHttpClient = it }

    init {
        if (currentUserId.isNotEmpty()) {
            loadAliases()
            if (initialConversationId != null) {
                initGroupChat(initialConversationId)
            } else if (otherUserId.isNotEmpty()) {
                initOneOnOneChat()
            }
        }
    }

    private fun loadAliases() {
        viewModelScope.launch {
            when (val result = userRepository.getAliases(currentUserId)) {
                is Resource.Success -> _uiState.update { it.copy(aliases = result.data) }
                is Resource.Error -> logW(TAG, "Failed to load aliases: ${result.message}")
                is Resource.Loading -> {}
            }
        }
    }

    private fun initOneOnOneChat() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, currentUserId = currentUserId) }

            // Load both users
            val currentUser =
                when (val result = userRepository.getUser(currentUserId)) {
                    is Resource.Success -> result.data
                    else -> null
                }
            val otherUser =
                when (val result = userRepository.getUser(otherUserId)) {
                    is Resource.Success -> result.data
                    else -> null
                }

            val isSystem = otherUserId == Constants.SYSTEM_USER_ID

            _uiState.update {
                it.copy(
                    currentUser = currentUser,
                    otherUser = otherUser,
                    currentUserName = currentUser?.displayName ?: "",
                    isSystemConversation = isSystem,
                )
            }

            // Check block/privacy restrictions (skip for system user)
            if (!isSystem) {
                val blockReason = checkRestrictions(currentUser, otherUser)
                if (blockReason != null) {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            isBlocked = true,
                            blockReason = blockReason,
                        )
                    }
                }
            }

            // Get or create conversation
            when (val result = pmRepository.getOrCreateConversation(currentUserId, otherUserId)) {
                is Resource.Success -> {
                    val conversation = result.data
                    _uiState.update { it.copy(conversationId = conversation.conversationId) }
                    observeMessages(conversation.conversationId)
                    observeSettings(conversation.conversationId)
                    connectConversationWs(conversation.conversationId)
                }
                is Resource.Error -> {
                    _uiState.update {
                        it.copy(isLoading = false, error = result.message)
                    }
                }
                is Resource.Loading -> {}
            }

            _uiState.update { it.copy(isLoading = false) }
        }
    }

    private fun initGroupChat(conversationId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, currentUserId = currentUserId) }

            val currentUser =
                when (val result = userRepository.getUser(currentUserId)) {
                    is Resource.Success -> result.data
                    else -> null
                }
            _uiState.update {
                it.copy(
                    currentUser = currentUser,
                    currentUserName = currentUser?.displayName ?: "",
                )
            }

            when (val result = pmRepository.getConversation(conversationId)) {
                is Resource.Success -> {
                    val conversation = result.data
                    // Load participant users
                    val participants =
                        when (val usersResult = userRepository.getUsers(conversation.participantIds)) {
                            is Resource.Success -> usersResult.data
                            else -> emptyList()
                        }
                    _uiState.update {
                        it.copy(
                            conversationId = conversationId,
                            isGroup = true,
                            conversationName = conversation.groupName ?: "Group",
                            groupParticipants = participants,
                            isAdmin = conversation.isAdmin(currentUserId),
                            isModOrAbove = conversation.isModOrAbove(currentUserId),
                            currentUserRole = conversation.roleOf(currentUserId),
                            conversation = conversation,
                        )
                    }
                    observeMessages(conversationId)
                    observeSettings(conversationId)
                    observeMuteStatus(conversationId)
                    loadGroupMutes(conversationId)
                    connectConversationWs(conversationId)
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = result.message) }
                }
                is Resource.Loading -> {}
            }

            _uiState.update { it.copy(isLoading = false) }
        }
    }

    private fun checkRestrictions(
        currentUser: User?,
        otherUser: User?,
    ): String? {
        if (currentUser == null || otherUser == null) return null

        // Check if blocked by target
        if (otherUser.blockedUserIds.contains(currentUserId)) {
            return "You are blocked by this user and cannot send messages."
        }
        // Check if you blocked target
        if (currentUser.blockedUserIds.contains(otherUserId)) {
            return "You have blocked this user. Unblock them to send messages."
        }
        // Check PM privacy
        when (otherUser.pmPrivacy) {
            PmPrivacy.NO_ONE -> return "This user does not accept private messages."
            PmPrivacy.FOLLOWERS_ONLY -> {
                // Target must follow the sender
                if (!otherUser.followingIds.contains(currentUserId)) {
                    return "This user only accepts messages from people they follow."
                }
            }
            PmPrivacy.EVERYONE -> {}
        }
        return null
    }

    private fun observeMessages(conversationId: String) {
        messagesJob?.cancel()
        messagesJob =
            viewModelScope.launch {
                try {
                    pmRepository.getMessages(conversationId, Constants.PM_MESSAGES_PAGE_SIZE).collect { liveMessages ->
                        val pending = pendingMessages.values.toList()
                        val combined =
                            (olderMessages + liveMessages + pending)
                                .distinctBy { it.messageId }
                                .sortedBy { it.createdAt }
                        _uiState.update { it.copy(messages = combined) }
                        resolveRoomInvites(combined)
                    }
                } catch (e: Exception) {
                    logE(TAG, "Messages observation failed: ${e.message}")
                    _uiState.update { it.copy(error = e.message ?: "Failed to load messages") }
                }
            }
    }

    private fun updateMessagesWithPending() {
        val live = _uiState.value.messages.filter { !it.messageId.startsWith("temp_") }
        val pending = pendingMessages.values.toList()
        val combined =
            (live + pending)
                .distinctBy { it.messageId }
                .sortedBy { it.createdAt }
        _uiState.update { it.copy(messages = combined) }
    }

    private fun observeSettings(conversationId: String) {
        settingsJob?.cancel()
        settingsJob =
            viewModelScope.launch {
                pmRepository.observeConversationSettings(conversationId, currentUserId).collect { settings ->
                    _uiState.update {
                        it.copy(
                            isMuted = settings.isMuted,
                            isPinned = settings.isPinned,
                        )
                    }
                }
            }
    }

    fun sendMessage(text: String) {
        val trimmed = text.trim()
        if (trimmed.isEmpty() || trimmed.length > Constants.MAX_PM_MESSAGE_LENGTH) return
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return

        // Moderation checks
        val moderationWarning = ModerationFilter.checkMessage(trimmed)
        if (moderationWarning != null) {
            _uiState.update { it.copy(error = moderationWarning) }
            return
        }
        if (ModerationFilter.isSpam(trimmed)) {
            _uiState.update { it.copy(error = "Please wait before sending the same message again.") }
            return
        }

        val replyTo = _uiState.value.replyingToMessage
        cancelReply()
        clearTyping()

        viewModelScope.launch {
            logI(TAG, "Sending message in conversation=$conversationId")
            when (
                pmRepository.sendTextMessage(
                    conversationId = conversationId,
                    senderId = currentUserId,
                    senderName = _uiState.value.currentUserName,
                    text = trimmed,
                    replyToMessageId = replyTo?.messageId,
                    replyToText = replyTo?.text?.take(100),
                    replyToSenderName = replyTo?.senderName,
                )
            ) {
                is Resource.Error -> {
                    logE(TAG, "Failed to send message")
                    _uiState.update { it.copy(error = "Failed to send message") }
                }
                else -> {}
            }
        }
    }

    fun sendImages(imageUrls: List<String>) {
        if (imageUrls.isEmpty()) return
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return

        val replyTo = _uiState.value.replyingToMessage
        cancelReply()

        viewModelScope.launch {
            when (
                pmRepository.sendImageMessage(
                    conversationId = conversationId,
                    senderId = currentUserId,
                    senderName = _uiState.value.currentUserName,
                    imageUrls = imageUrls,
                    replyToMessageId = replyTo?.messageId,
                    replyToText = replyTo?.let { if (it.imageUrls.isNotEmpty()) "[Image]" else it.text.take(100) },
                    replyToSenderName = replyTo?.senderName,
                )
            ) {
                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to send image") }
                }
                else -> {}
            }
        }
    }

    fun startEditing(message: PrivateMessage) {
        // Check edit window
        val elapsed = currentTimeMillis() - message.createdAt
        if (elapsed > Constants.PM_EDIT_WINDOW_MS) return
        if (message.senderId != currentUserId) return

        _uiState.update {
            it.copy(
                editingMessageId = message.messageId,
                editingOriginalText = message.text,
            )
        }
    }

    fun cancelEditing() {
        _uiState.update {
            it.copy(editingMessageId = null, editingOriginalText = "")
        }
    }

    fun submitEdit(newText: String) {
        val trimmed = newText.trim()
        val messageId = _uiState.value.editingMessageId ?: return
        val conversationId = _uiState.value.conversationId
        if (trimmed.isEmpty() || conversationId.isEmpty()) return

        cancelEditing()

        viewModelScope.launch {
            when (pmRepository.editMessage(conversationId, messageId, trimmed)) {
                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to edit message") }
                }
                else -> {}
            }
        }
    }

    fun startReply(message: PrivateMessage) {
        _uiState.update { it.copy(replyingToMessage = message) }
    }

    fun cancelReply() {
        _uiState.update { it.copy(replyingToMessage = null) }
    }

    fun markMessagesAsRead() {
        val conversationId = _uiState.value.conversationId
        val messages = _uiState.value.messages
        if (conversationId.isEmpty() || messages.isEmpty()) return

        // Find the last message not sent by the current user (works for both 1-on-1 and group)
        val lastOtherMessage = messages.lastOrNull { it.senderId != currentUserId } ?: return
        if (currentUserId in lastOtherMessage.readBy) return

        viewModelScope.launch {
            pmRepository.markAsRead(conversationId, currentUserId, lastOtherMessage.messageId)
        }
    }

    fun toggleMute() {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        val newMuted = !_uiState.value.isMuted
        viewModelScope.launch {
            pmRepository.muteConversation(conversationId, currentUserId, newMuted)
        }
    }

    fun togglePin() {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        val newPinned = !_uiState.value.isPinned
        viewModelScope.launch {
            pmRepository.pinConversation(conversationId, currentUserId, newPinned)
        }
    }

    fun hideConversation() {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            pmRepository.hideConversation(conversationId, currentUserId)
        }
    }

    fun refreshMessages() {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        _uiState.update { it.copy(isRefreshing = true) }
        observeMessages(conversationId)
        viewModelScope.launch {
            kotlinx.coroutines.delay(500)
            _uiState.update { it.copy(isRefreshing = false) }
        }
    }

    fun loadOlderMessages() {
        val conversationId = _uiState.value.conversationId
        val messages = _uiState.value.messages
        if (conversationId.isEmpty() || messages.isEmpty() || _uiState.value.isLoadingOlder) return

        val oldestTimestamp = messages.first().createdAt
        _uiState.update { it.copy(isLoadingOlder = true) }

        viewModelScope.launch {
            when (
                val result =
                    pmRepository.loadOlderMessages(
                        conversationId,
                        oldestTimestamp,
                        Constants.PM_MESSAGES_PAGE_SIZE,
                    )
            ) {
                is Resource.Success -> {
                    val fetched = result.data
                    olderMessages.addAll(0, fetched)
                    val combined =
                        (olderMessages + _uiState.value.messages)
                            .distinctBy { it.messageId }
                            .sortedBy { it.createdAt }
                    _uiState.update {
                        it.copy(
                            messages = combined,
                            isLoadingOlder = false,
                            hasOlderMessages = fetched.size >= Constants.PM_MESSAGES_PAGE_SIZE,
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoadingOlder = false) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    suspend fun getEditHistory(messageId: String): List<MessageEdit> {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return emptyList()
        return when (val result = pmRepository.getEditHistory(conversationId, messageId)) {
            is Resource.Success -> result.data
            else -> emptyList()
        }
    }

    fun onTextChanged() {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return

        if (conversationWs != null) {
            conversationWs.sendTyping(true)
        } else {
            typingRepository.setTyping(conversationId, currentUserId, true)
        }

        // Auto-reset typing after debounce
        typingResetJob?.cancel()
        typingResetJob =
            viewModelScope.launch {
                delay(Constants.TYPING_DEBOUNCE_MS)
                if (conversationWs != null) {
                    conversationWs.sendTyping(false)
                } else {
                    typingRepository.setTyping(conversationId, currentUserId, false)
                }
            }
    }

    /**
     * Connect the conversation WebSocket for instant message and typing events.
     * Falls back to the old TypingRepository WebSocket if conversationWs is null (e.g. iOS).
     */
    private fun connectConversationWs(conversationId: String) {
        if (conversationWs != null) {
            conversationWs.connect(conversationId, currentUserId)
            wsEventsJob?.cancel()
            wsEventsJob =
                viewModelScope.launch {
                    conversationWs.events.collect { event ->
                        when (event) {
                            is ConversationEvent.NewMessage -> {
                                // Immediately refetch messages (bypass slow polling)
                                refreshMessages(conversationId)
                            }
                            is ConversationEvent.Typing -> {
                                // For 1-on-1, only show typing from the other user
                                if (!_uiState.value.isGroup && event.userId != otherUserId) return@collect
                                _uiState.update { it.copy(isOtherUserTyping = event.isTyping) }
                            }
                        }
                    }
                }
        } else {
            // Fallback: old TypingRepository WS (no new_message support)
            typingJob?.cancel()
            typingJob =
                viewModelScope.launch {
                    typingRepository.observeTyping(conversationId, otherUserId).collect { isTyping ->
                        _uiState.update { it.copy(isOtherUserTyping = isTyping) }
                    }
                }
        }
    }

    /**
     * Immediately restart the message polling flow to pick up new messages.
     * This forces a fresh API call instead of waiting for the next poll cycle.
     */
    private fun refreshMessages(conversationId: String) {
        observeMessages(conversationId)
    }

    private fun clearTyping() {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isNotEmpty()) {
            if (conversationWs != null) {
                conversationWs.sendTyping(false)
            } else {
                typingRepository.setTyping(conversationId, currentUserId, false)
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        clearTyping()
        conversationWs?.disconnect()
        lazyHttpClient?.close()
    }

    fun reportMessage(
        message: PrivateMessage,
        reason: String,
        description: String,
    ) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        val currentUser = _uiState.value.currentUser
        val state = _uiState.value
        val reportedUser =
            if (state.isGroup) {
                state.groupParticipants.find { it.uid == message.senderId }
            } else {
                state.otherUser
            }
        viewModelScope.launch {
            when (
                reportRepository.reportMessage(
                    reporterId = currentUserId,
                    reporterName = currentUser?.displayName ?: "",
                    reporterUniqueId = currentUser?.uniqueId ?: 0L,
                    reportedUserId = message.senderId,
                    reportedUserName = reportedUser?.displayName ?: message.senderName,
                    reportedUserUniqueId = reportedUser?.uniqueId ?: 0L,
                    conversationId = conversationId,
                    messageId = message.messageId,
                    messageText = message.text,
                    reason = reason,
                    description = description,
                )
            ) {
                is Resource.Success -> {
                    _uiState.update { it.copy(successMessage = "Report submitted") }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to submit report") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun toggleReaction(
        messageId: String,
        emoji: String,
    ) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            pmRepository.toggleReaction(conversationId, messageId, emoji, currentUserId)
        }
    }

    fun toggleSearch() {
        val searching = !_uiState.value.isSearching
        _uiState.update {
            it.copy(
                isSearching = searching,
                searchQuery = if (!searching) "" else it.searchQuery,
                searchResults = if (!searching) emptyList() else it.searchResults,
            )
        }
    }

    fun searchMessages(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        if (query.length < 2) {
            _uiState.update { it.copy(searchResults = emptyList()) }
            return
        }
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (val result = pmRepository.searchMessages(conversationId, query)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(searchResults = result.data) }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Search failed") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    // ===== Image Upload =====

    fun uploadAndSendImages(imageDataList: List<ByteArray>) {
        if (imageDataList.isEmpty() || imageDataList.size > Constants.PM_MAX_IMAGES_PER_MESSAGE) return

        val tempId = "temp_${currentTimeMillis()}"
        val pendingMsg =
            PrivateMessage(
                messageId = tempId,
                senderId = currentUserId,
                senderName = _uiState.value.currentUserName,
                type = PrivateMessageType.IMAGE,
                sendStatus = SendStatus.SENDING,
                localImageData = imageDataList,
                createdAt = currentTimeMillis(),
            )
        pendingMessages[tempId] = pendingMsg
        updateMessagesWithPending()

        viewModelScope.launch {
            try {
                val urls = mutableListOf<String>()
                for (bytes in imageDataList) {
                    val compressed = compressImage(bytes)
                    when (val result = storageRepository.uploadImage(currentUserId, "pm_images", compressed)) {
                        is Resource.Success -> urls.add(result.data)
                        is Resource.Error -> {
                            pendingMessages[tempId] = pendingMsg.copy(sendStatus = SendStatus.FAILED)
                            updateMessagesWithPending()
                            return@launch
                        }
                        else -> {
                            pendingMessages[tempId] = pendingMsg.copy(sendStatus = SendStatus.FAILED)
                            updateMessagesWithPending()
                            return@launch
                        }
                    }
                }
                pendingMessages.remove(tempId)
                updateMessagesWithPending()
                sendImages(urls)
            } catch (e: Exception) {
                pendingMessages[tempId] = pendingMsg.copy(sendStatus = SendStatus.FAILED)
                updateMessagesWithPending()
            }
        }
    }

    // ===== Group Management =====

    fun addGroupParticipant(userId: String) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (pmRepository.addGroupParticipant(conversationId, userId)) {
                is Resource.Success -> {
                    // Reload participants
                    initGroupChat(conversationId)
                }
                is Resource.Error -> _uiState.update { it.copy(error = "Failed to add participant") }
                is Resource.Loading -> {}
            }
        }
    }

    fun removeGroupParticipant(userId: String) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (pmRepository.removeGroupParticipant(conversationId, userId)) {
                is Resource.Success -> {
                    initGroupChat(conversationId)
                }
                is Resource.Error -> _uiState.update { it.copy(error = "Failed to remove participant") }
                is Resource.Loading -> {}
            }
        }
    }

    fun updateGroupName(name: String) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty() || name.isBlank()) return
        viewModelScope.launch {
            when (pmRepository.updateGroupName(conversationId, name)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(conversationName = name) }
                }
                is Resource.Error -> _uiState.update { it.copy(error = "Failed to update group name") }
                is Resource.Loading -> {}
            }
        }
    }

    fun leaveGroup() {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            if (_uiState.value.isAdmin) {
                // Admin leaving → soft delete (close the group)
                pmRepository.closeGroupConversation(conversationId)
            } else {
                pmRepository.removeGroupParticipant(conversationId, currentUserId)
            }
        }
    }

    // ===== Sticker Support =====

    fun closeStickerPicker() {
        _uiState.update { it.copy(showStickerPicker = false) }
    }

    fun toggleStickerPicker() {
        val newVisible = !_uiState.value.showStickerPicker
        if (newVisible && stickerStorage != null) {
            _uiState.update {
                it.copy(
                    showStickerPicker = true,
                    stickers = stickerStorage.getStickers(),
                )
            }
        } else {
            _uiState.update { it.copy(showStickerPicker = newVisible) }
        }
    }

    fun sendSticker(sticker: Sticker) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return

        // Mark as recent
        stickerStorage?.markAsRecent(sticker.id)

        // If sticker has a URL, send directly; otherwise upload local file first
        if (sticker.url.isNotBlank()) {
            sendStickerMessage(sticker.url)
        } else if (sticker.localPath != null) {
            val tempId = "temp_${currentTimeMillis()}"
            val pendingMsg =
                PrivateMessage(
                    messageId = tempId,
                    senderId = currentUserId,
                    senderName = _uiState.value.currentUserName,
                    type = PrivateMessageType.STICKER,
                    stickerUrl = sticker.localPath,
                    sendStatus = SendStatus.SENDING,
                    createdAt = currentTimeMillis(),
                )
            pendingMessages[tempId] = pendingMsg
            updateMessagesWithPending()

            viewModelScope.launch {
                val bytes =
                    try {
                        stickerStorage?.readStickerBytes(sticker.id) ?: error("No sticker storage")
                    } catch (e: Exception) {
                        pendingMessages[tempId] = pendingMsg.copy(sendStatus = SendStatus.FAILED)
                        updateMessagesWithPending()
                        return@launch
                    }
                // Skip compression for animated formats (GIF/WebP) to preserve animation
                val isGif =
                    bytes.size >= 4 &&
                        bytes[0] == 0x47.toByte() &&
                        bytes[1] == 0x49.toByte() &&
                        bytes[2] == 0x46.toByte() &&
                        bytes[3] == 0x38.toByte()
                val isWebp =
                    bytes.size >= 12 &&
                        bytes[0] == 0x52.toByte() &&
                        bytes[1] == 0x49.toByte() &&
                        bytes[2] == 0x46.toByte() &&
                        bytes[3] == 0x46.toByte() &&
                        bytes[8] == 0x57.toByte() &&
                        bytes[9] == 0x45.toByte() &&
                        bytes[10] == 0x42.toByte() &&
                        bytes[11] == 0x50.toByte()
                val uploadBytes = if (isGif || isWebp) bytes else compressImage(bytes)
                when (val result = storageRepository.uploadImage(currentUserId, "stickers", uploadBytes)) {
                    is Resource.Success -> {
                        pendingMessages.remove(tempId)
                        updateMessagesWithPending()
                        sendStickerMessage(result.data)
                    }
                    is Resource.Error -> {
                        pendingMessages[tempId] = pendingMsg.copy(sendStatus = SendStatus.FAILED)
                        updateMessagesWithPending()
                    }
                    else -> {
                        pendingMessages[tempId] = pendingMsg.copy(sendStatus = SendStatus.FAILED)
                        updateMessagesWithPending()
                    }
                }
            }
        }
    }

    fun sendSticker(stickerUrl: String) {
        sendStickerMessage(stickerUrl)
    }

    private fun sendStickerMessage(stickerUrl: String) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (
                pmRepository.sendStickerMessage(
                    conversationId = conversationId,
                    senderId = currentUserId,
                    senderName = _uiState.value.currentUserName,
                    stickerUrl = stickerUrl,
                )
            ) {
                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to send sticker") }
                }
                else -> {}
            }
        }
    }

    fun deleteSticker(id: String) {
        if (stickerStorage == null) return
        stickerStorage.removeSticker(id)
        _uiState.update { it.copy(stickers = stickerStorage.getStickers()) }
    }

    fun moveStickerToFront(id: String) {
        if (stickerStorage == null) return
        stickerStorage.moveSticker(id, 0)
        _uiState.update { it.copy(stickers = stickerStorage.getStickers()) }
    }

    fun addStickerFromImage(imageData: ByteArray) {
        if (stickerStorage == null) return
        val id = currentTimeMillis().toString()
        stickerStorage.addSticker(id, imageData)
        _uiState.update {
            it.copy(stickers = stickerStorage.getStickers())
        }
        // Background pre-upload to R2 for instant sends later
        viewModelScope.launch {
            try {
                val isGif =
                    imageData.size >= 4 &&
                        imageData[0] == 0x47.toByte() &&
                        imageData[1] == 0x49.toByte() &&
                        imageData[2] == 0x46.toByte() &&
                        imageData[3] == 0x38.toByte()
                val isWebp =
                    imageData.size >= 12 &&
                        imageData[0] == 0x52.toByte() &&
                        imageData[1] == 0x49.toByte() &&
                        imageData[2] == 0x46.toByte() &&
                        imageData[3] == 0x46.toByte() &&
                        imageData[8] == 0x57.toByte() &&
                        imageData[9] == 0x45.toByte() &&
                        imageData[10] == 0x42.toByte() &&
                        imageData[11] == 0x50.toByte()
                val uploadBytes = if (isGif || isWebp) imageData else compressImage(imageData)
                when (val result = storageRepository.uploadImage(currentUserId, "stickers", uploadBytes)) {
                    is Resource.Success -> {
                        stickerStorage.updateStickerUrl(id, result.data)
                        _uiState.update { it.copy(stickers = stickerStorage.getStickers()) }
                    }
                    else -> { /* Silently ignore — first send will upload as fallback */ }
                }
            } catch (e: Exception) {
                logW(TAG, "Sticker pre-upload failed (best-effort)", e)
            }
        }
    }

    fun saveStickerFromUrl(url: String) {
        if (stickerStorage == null || url.isBlank()) return
        viewModelScope.launch {
            try {
                val bytes = httpClient.get(url).bodyAsBytes()
                // Check for duplicates by comparing file content
                val existing = stickerStorage.getStickers()
                val isDuplicate =
                    existing.any { sticker ->
                        stickerStorage.readStickerBytes(sticker.id)?.contentEquals(bytes) == true
                    }
                if (isDuplicate) {
                    _uiState.update { it.copy(error = "You already have this sticker") }
                    return@launch
                }
                val id = currentTimeMillis().toString()
                stickerStorage.addSticker(id, bytes)
                stickerStorage.updateStickerUrl(id, url)
                _uiState.update {
                    it.copy(
                        stickers = stickerStorage.getStickers(),
                        error = "Sticker saved!",
                    )
                }
            } catch (e: Exception) {
                logW(TAG, "Failed to save sticker from URL", e)
                _uiState.update { it.copy(error = "Failed to save sticker") }
            }
        }
    }

    fun sendRoomInvite(
        roomId: String,
        roomName: String,
    ) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (
                pmRepository.sendRoomInviteMessage(
                    conversationId = conversationId,
                    senderId = currentUserId,
                    senderName = _uiState.value.currentUserName,
                    roomId = roomId,
                    roomName = roomName,
                )
            ) {
                is Resource.Error -> _uiState.update { it.copy(error = "Failed to send room invite") }
                else -> {}
            }
        }
    }

    fun recallMessage(messageId: String) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (pmRepository.recallMessage(conversationId, messageId)) {
                is Resource.Error -> _uiState.update { it.copy(error = "Failed to recall message") }
                else -> {}
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    // ===== Moderator Actions =====

    fun muteGroupMember(
        userId: String,
        duration: Long?,
        reason: String?,
    ) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (pmRepository.muteGroupMember(conversationId, userId, duration, reason)) {
                is Resource.Success -> {
                    loadGroupMutes(conversationId)
                    // Send MOD_ACTION message
                    val durationText =
                        when (duration) {
                            Constants.MUTE_DURATION_5MIN -> "5 minutes"
                            Constants.MUTE_DURATION_1HR -> "1 hour"
                            Constants.MUTE_DURATION_24HR -> "24 hours"
                            null -> "permanently"
                            else -> "${duration / 60000} minutes"
                        }
                    val targetName =
                        _uiState.value.groupParticipants
                            .find { it.uid == userId }
                            ?.displayName ?: "User"
                    val actionText =
                        "${_uiState.value.currentUserName} muted $targetName for $durationText" +
                            if (reason != null) ". Reason: $reason" else ""
                    sendModActionMessage(actionText)
                }
                is Resource.Error -> _uiState.update { it.copy(error = "Failed to mute member") }
                is Resource.Loading -> {}
            }
        }
    }

    fun unmuteGroupMember(userId: String) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (pmRepository.unmuteGroupMember(conversationId, userId)) {
                is Resource.Success -> {
                    loadGroupMutes(conversationId)
                    if (userId == currentUserId) {
                        _uiState.update { it.copy(currentUserMuteInfo = null) }
                    }
                    val targetName =
                        _uiState.value.groupParticipants
                            .find { it.uid == userId }
                            ?.displayName ?: "User"
                    sendModActionMessage("${_uiState.value.currentUserName} unmuted $targetName")
                }
                is Resource.Error -> _uiState.update { it.copy(error = "Failed to unmute member") }
                is Resource.Loading -> {}
            }
        }
    }

    fun hideMessage(messageId: String) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (pmRepository.hideMessage(conversationId, messageId, currentUserId)) {
                is Resource.Success -> {
                    sendModActionMessage("${_uiState.value.currentUserName} hid a message")
                }
                is Resource.Error -> _uiState.update { it.copy(error = "Failed to hide message") }
                is Resource.Loading -> {}
            }
        }
    }

    private fun sendModActionMessage(text: String) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            pmRepository.sendTextMessage(
                conversationId = conversationId,
                senderId = Constants.SYSTEM_USER_ID,
                senderName = "System",
                text = text,
            )
        }
    }

    private fun observeMuteStatus(conversationId: String) {
        viewModelScope.launch {
            when (val result = pmRepository.getGroupMutes(conversationId)) {
                is Resource.Success -> {
                    val myMute = result.data.find { it.mutedUserId == currentUserId && it.isActive }
                    if (myMute != null) {
                        // Check if expired
                        val now = currentTimeMillis()
                        if (myMute.expiresAt != null && myMute.expiresAt < now) {
                            // Auto-unmute
                            pmRepository.unmuteGroupMember(conversationId, currentUserId)
                            _uiState.update { it.copy(currentUserMuteInfo = null) }
                        } else {
                            _uiState.update { it.copy(currentUserMuteInfo = myMute) }
                        }
                    }
                }
                else -> {}
            }
        }
    }

    private fun loadGroupMutes(conversationId: String) {
        viewModelScope.launch {
            when (val result = pmRepository.getGroupMutes(conversationId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(groupMutes = result.data) }
                }
                else -> {}
            }
        }
    }

    // ===== Group Role/Permission Management =====

    fun updateGroupRoles(
        adminIds: List<String>,
        modIds: List<String>,
    ) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (pmRepository.updateGroupRoles(conversationId, adminIds, modIds)) {
                is Resource.Success -> initGroupChat(conversationId)
                is Resource.Error -> _uiState.update { it.copy(error = "Failed to update roles") }
                is Resource.Loading -> {}
            }
        }
    }

    fun updateGroupPermissions(permissions: GroupPermissions) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (pmRepository.updateGroupPermissions(conversationId, permissions)) {
                is Resource.Success -> initGroupChat(conversationId)
                is Resource.Error -> _uiState.update { it.copy(error = "Failed to update permissions") }
                is Resource.Loading -> {}
            }
        }
    }

    fun updateGroupDescription(description: String) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (pmRepository.updateGroupDescription(conversationId, description)) {
                is Resource.Success -> {}
                is Resource.Error -> _uiState.update { it.copy(error = "Failed to update description") }
                is Resource.Loading -> {}
            }
        }
    }

    fun updateGroupPhoto(photoUrl: String?) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (pmRepository.updateGroupPhoto(conversationId, photoUrl)) {
                is Resource.Success -> {}
                is Resource.Error -> _uiState.update { it.copy(error = "Failed to update group photo") }
                is Resource.Loading -> {}
            }
        }
    }

    fun transferOwnership(newOwnerId: String) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (pmRepository.transferOwnership(conversationId, newOwnerId)) {
                is Resource.Success -> initGroupChat(conversationId)
                is Resource.Error -> _uiState.update { it.copy(error = "Failed to transfer ownership") }
                is Resource.Loading -> {}
            }
        }
    }

    fun updateSystemMessageConfig(config: com.shyden.shytalk.core.model.SystemMessageConfig) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (pmRepository.updateSystemMessageConfig(conversationId, config)) {
                is Resource.Success -> {}
                is Resource.Error -> _uiState.update { it.copy(error = "Failed to update config") }
                is Resource.Loading -> {}
            }
        }
    }

    fun updateModNotifyMode(mode: String) {
        val conversationId = _uiState.value.conversationId
        if (conversationId.isEmpty()) return
        viewModelScope.launch {
            when (pmRepository.updateModNotifyMode(conversationId, mode)) {
                is Resource.Success -> {}
                is Resource.Error -> _uiState.update { it.copy(error = "Failed to update notify mode") }
                is Resource.Loading -> {}
            }
        }
    }

    // --- Room Invite Preview ---

    private val fetchedRoomIds = mutableSetOf<String>()

    private fun resolveRoomInvites(messages: List<PrivateMessage>) {
        val repo = roomRepository ?: return
        val roomIds =
            messages
                .filter { it.type == PrivateMessageType.ROOM_INVITE && !it.roomInviteId.isNullOrEmpty() }
                .mapNotNull { it.roomInviteId }
                .distinct()
                .filter { it !in fetchedRoomIds }
        if (roomIds.isEmpty()) return

        fetchedRoomIds.addAll(roomIds)
        viewModelScope.launch {
            for (roomId in roomIds) {
                val result = repo.getRoom(roomId)
                if (result !is Resource.Success) continue
                val room = result.data

                // Collect seated user IDs — for closed rooms, use historical data
                val seatedUserIds =
                    if (room.state == RoomState.CLOSED) {
                        room.allTimeSeatUserIds.toList()
                    } else {
                        room.seats.values
                            .filter { it.state == SeatState.OCCUPIED && it.userId != null }
                            .mapNotNull { it.userId }
                    }

                // Batch-fetch users
                val seatUsers = mutableMapOf<String, User>()
                if (seatedUserIds.isNotEmpty()) {
                    when (val usersResult = userRepository.getUsers(seatedUserIds)) {
                        is Resource.Success -> usersResult.data.forEach { seatUsers[it.uid] = it }
                        else -> {}
                    }
                }

                _uiState.update { state ->
                    state.copy(roomInvites = state.roomInvites + (roomId to RoomInvitePreview(room, seatUsers)))
                }
            }
        }
    }

    fun translateMessage(messageId: String) {
        val repo = translationRepository ?: return
        val message = _uiState.value.messages.find { it.messageId == messageId } ?: return
        if (_uiState.value.translations.containsKey(messageId)) return
        val convId = _uiState.value.conversationId
        val targetLang =
            com.shyden.shytalk.core.util.LanguagePreference
                .get()
        viewModelScope.launch {
            val messagePath = if (convId.isNotEmpty()) "conversations/$convId/messages/$messageId" else null
            when (val result = repo.translate(message.text, targetLang, messagePath)) {
                is Resource.Success ->
                    _uiState.update {
                        it.copy(translations = it.translations + (messageId to result.data.translatedText))
                    }
                else -> { /* Loading or Error — silently fail */ }
            }
        }
    }
}
