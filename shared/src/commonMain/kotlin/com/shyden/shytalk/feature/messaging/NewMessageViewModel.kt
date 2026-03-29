package com.shyden.shytalk.feature.messaging

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class NewMessageUiState(
    val availableUsers: List<User> = emptyList(),
    val selectedIds: Set<String> = emptySet(),
    val isLoading: Boolean = true,
    val error: UiText? = null,
    val searchQuery: String = "",
    val recentUsers: List<User> = emptyList(),
    val searchAllMode: Boolean = false,
    val allUsersSearchResults: List<User> = emptyList(),
    val isSearchingAll: Boolean = false,
    val ownedGroupCount: Int = 0,
)

class NewMessageViewModel(
    private val pmRepository: PrivateMessageRepository,
    private val userRepository: UserRepository,
    private val authRepository: AuthRepository,
) : ViewModel() {
    companion object {
        private const val TAG = "NewMessageViewModel"
    }

    private val _uiState = MutableStateFlow(NewMessageUiState())
    val uiState: StateFlow<NewMessageUiState> = _uiState.asStateFlow()

    private val currentUserId: String = authRepository.currentUserId ?: ""
    private var searchJob: Job? = null

    init {
        logI(TAG, "Initializing new message screen")
        loadAvailableUsers()
        loadRecentUsers()
        loadOwnedGroupCount()
    }

    private fun loadAvailableUsers() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            val currentUser =
                when (val result = userRepository.getUser(currentUserId)) {
                    is Resource.Success -> result.data
                    else -> {
                        _uiState.update { it.copy(isLoading = false, error = UiText.res(Res.string.error_load_user_data)) }
                        return@launch
                    }
                }

            val allIds =
                (currentUser.followerIds + currentUser.followingIds)
                    .distinct()
                    .filter { it != currentUserId }

            if (allIds.isEmpty()) {
                _uiState.update { it.copy(isLoading = false, availableUsers = emptyList()) }
                return@launch
            }

            when (val result = userRepository.getUsers(allIds)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            isLoading = false,
                            availableUsers = result.data.sortedBy { u -> u.displayName.lowercase() },
                        )
                    }
                }
                else -> {
                    _uiState.update { it.copy(isLoading = false, error = UiText.res(Res.string.error_load_users)) }
                }
            }
        }
    }

    private fun loadRecentUsers() {
        viewModelScope.launch {
            // Get recent conversations and extract user IDs from the most recent ones
            pmRepository.getConversations(currentUserId).collect { conversations ->
                val recentUserIds =
                    conversations
                        .filter { !it.isGroup && !it.isClosed }
                        .sortedByDescending { it.lastMessageAt }
                        .take(5)
                        .mapNotNull { it.otherUserId(currentUserId) }
                        .filter { it != Constants.SYSTEM_USER_ID }

                if (recentUserIds.isNotEmpty()) {
                    when (val result = userRepository.getUsers(recentUserIds)) {
                        is Resource.Success -> {
                            // Maintain the order from recentUserIds
                            val usersMap = result.data.associateBy { it.uid }
                            val ordered = recentUserIds.mapNotNull { usersMap[it] }
                            _uiState.update { it.copy(recentUsers = ordered) }
                        }
                        else -> Unit
                    }
                }
            }
        }
    }

    private fun loadOwnedGroupCount() {
        viewModelScope.launch {
            when (val result = pmRepository.getOwnedGroupCount(currentUserId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(ownedGroupCount = result.data) }
                }
                else -> Unit
            }
        }
    }

    fun toggleSelection(userId: String) {
        _uiState.update { state ->
            val current = state.selectedIds
            val updated =
                if (userId in current) {
                    current - userId
                } else {
                    if (current.size >= Constants.MAX_GROUP_PARTICIPANTS - 1) {
                        return@update state.copy(error = UiText.res(Res.string.error_max_participants, Constants.MAX_GROUP_PARTICIPANTS))
                    }
                    current + userId
                }
            state.copy(selectedIds = updated)
        }
    }

    fun setSearchQuery(query: String) {
        _uiState.update { it.copy(searchQuery = query) }
        if (_uiState.value.searchAllMode && query.isNotBlank()) {
            searchAllUsers(query)
        }
    }

    fun toggleSearchAllMode() {
        val newMode = !_uiState.value.searchAllMode
        _uiState.update {
            it.copy(
                searchAllMode = newMode,
                allUsersSearchResults = emptyList(),
            )
        }
        if (newMode && _uiState.value.searchQuery.isNotBlank()) {
            searchAllUsers(_uiState.value.searchQuery)
        }
    }

    private fun searchAllUsers(query: String) {
        searchJob?.cancel()
        searchJob =
            viewModelScope.launch {
                delay(300) // Debounce
                _uiState.update { it.copy(isSearchingAll = true) }
                when (val result = pmRepository.searchUsers(query, currentUserId)) {
                    is Resource.Success -> {
                        _uiState.update {
                            it.copy(
                                isSearchingAll = false,
                                allUsersSearchResults = result.data,
                            )
                        }
                    }
                    is Resource.Error -> {
                        _uiState.update {
                            it.copy(isSearchingAll = false, error = UiText.plain(result.message))
                        }
                    }
                    is Resource.Loading -> Unit
                }
            }
    }

    fun getFilteredUsers(): List<User> {
        val query = _uiState.value.searchQuery
        val users = _uiState.value.availableUsers
        return if (query.isBlank()) {
            users
        } else {
            users.filter { it.displayName.contains(query, ignoreCase = true) }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
