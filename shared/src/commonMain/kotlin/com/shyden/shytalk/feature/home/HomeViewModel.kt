package com.shyden.shytalk.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.Banner
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BannerRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class HomeUiState(
    val banners: List<Banner> = emptyList(),
    val rooms: List<ChatRoom> = emptyList(),
    val seatUsers: Map<String, User> = emptyMap(),
    val isLoading: Boolean = true,
    val isRefreshing: Boolean = false,
    val error: String? = null,
    val createdRoomId: String? = null,
    val lastRoomName: String = "",
)

class HomeViewModel(
    private val roomRepository: RoomRepository,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val bannerRepository: BannerRepository,
) : ViewModel() {
    private val _uiState = MutableStateFlow(HomeUiState())
    val uiState: StateFlow<HomeUiState> = _uiState.asStateFlow()

    private val userCache = linkedMapOf<String, User>()
    private val userCacheTimestamps = mutableMapOf<String, Long>()

    private fun cacheUser(
        key: String,
        user: User,
    ) {
        userCache[key] = user
        userCacheTimestamps[key] = currentTimeMillis()
        while (userCache.size > 500) {
            val iter = userCache.keys.iterator()
            if (iter.hasNext()) {
                val oldest = iter.next()
                iter.remove()
                userCacheTimestamps.remove(oldest)
            } else {
                break
            }
        }
    }

    private var myBlockedUserIds: Set<String> = emptySet()
    private var allRooms: List<ChatRoom> = emptyList()
    private var periodicRefreshJob: Job? = null

    val currentUserId: String?
        get() = authRepository.currentUserId

    init {
        logI(TAG, "Initializing HomeViewModel")
        loadBlockedUsersAndFilter()
        loadLastRoomName()
        observeRooms()
        observeUserUpdates()
        loadBanners()
    }

    private fun loadBanners() {
        viewModelScope.launch {
            try {
                val banners = bannerRepository.getActiveBanners()
                logI(TAG, "Loaded ${banners.size} active banners")
                _uiState.update { it.copy(banners = banners) }
            } catch (e: Exception) {
                logE(TAG, "Failed to load banners: ${e.message}")
            }
        }
    }

    private fun loadLastRoomName() {
        val userId = currentUserId ?: return
        viewModelScope.launch {
            when (val result = userRepository.getUser(userId)) {
                is Resource.Success -> {
                    val name = result.data.lastRoomName
                    if (!name.isNullOrBlank()) {
                        _uiState.update { it.copy(lastRoomName = name) }
                    }
                }
                else -> Unit
            }
        }
    }

    private fun loadBlockedUsersAndFilter() {
        val userId = currentUserId ?: return
        viewModelScope.launch {
            when (val result = userRepository.getBlockedUserIds(userId)) {
                is Resource.Success -> {
                    myBlockedUserIds = result.data
                    filterAndEmitRooms()
                }
                else -> Unit
            }
        }
    }

    private fun observeRooms() {
        viewModelScope.launch {
            roomRepository
                .getActiveRooms()
                .catch { e ->
                    logE(TAG, "Room observation failed: ${e.message}")
                    _uiState.update { it.copy(isLoading = false, error = e.message) }
                }.collect { rooms ->
                    logI(TAG, "Received ${rooms.size} active rooms")
                    allRooms = rooms
                    filterAndEmitRooms()
                }
        }
    }

    private fun observeUserUpdates() {
        viewModelScope.launch {
            userRepository.userUpdates.collect { updatedUser ->
                if (updatedUser.uid in userCache) {
                    cacheUser(updatedUser.uid, updatedUser)
                    _uiState.update { state ->
                        state.copy(
                            seatUsers =
                                state.seatUsers.let { map ->
                                    if (updatedUser.uid in map) map + (updatedUser.uid to updatedUser) else map
                                },
                        )
                    }
                }
            }
        }
    }

    fun refreshRooms() {
        val userId = currentUserId ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isRefreshing = true) }
            when (val result = userRepository.getBlockedUserIds(userId)) {
                is Resource.Success -> {
                    myBlockedUserIds = result.data
                }
                else -> Unit
            }
            userCache.clear()
            filterAndEmitRooms()
            loadBanners()
            _uiState.update { it.copy(isRefreshing = false) }
        }
    }

    fun setActive(active: Boolean) {
        if (active) {
            startPeriodicRefresh()
        } else {
            periodicRefreshJob?.cancel()
            periodicRefreshJob = null
        }
    }

    private fun startPeriodicRefresh() {
        periodicRefreshJob?.cancel()
        periodicRefreshJob =
            viewModelScope.launch {
                while (true) {
                    delay(REFRESH_INTERVAL_MS)
                    refreshRoomsInternal()
                }
            }
    }

    private suspend fun refreshRoomsInternal() {
        val userId = currentUserId ?: return
        when (val result = userRepository.getBlockedUserIds(userId)) {
            is Resource.Success -> {
                myBlockedUserIds = result.data
            }
            else -> Unit
        }
        // Evict stale cache entries instead of clearing everything
        val cutoff = currentTimeMillis() - REFRESH_INTERVAL_MS
        val staleKeys = userCacheTimestamps.filter { it.value < cutoff }.keys
        staleKeys.forEach { key ->
            userCache.remove(key)
            userCacheTimestamps.remove(key)
        }
        filterAndEmitRooms()
        loadBanners()
    }

    private suspend fun filterAndEmitRooms() {
        val userId = currentUserId ?: return

        // Collect all user IDs we need: owners + seated users (lazy sequences)
        val ownerIds = allRooms.asSequence().map { it.ownerId }.toSet()
        val seatedUserIds =
            allRooms
                .asSequence()
                .flatMap { room ->
                    room.seats.values
                        .asSequence()
                        .filter { it.state == SeatState.OCCUPIED && it.userId != null }
                        .mapNotNull { it.userId }
                }.toSet()
        val allNeededIds = ownerIds + seatedUserIds

        // Single batch load for all uncached users
        val newUserIds = allNeededIds.filter { it !in userCache }
        if (newUserIds.isNotEmpty()) {
            when (val result = userRepository.getUsers(newUserIds.toList())) {
                is Resource.Success -> {
                    result.data.forEach { user -> cacheUser(user.uid, user) }
                }
                else -> Unit
            }
        }

        val filtered =
            allRooms
                .filter { room ->
                    // Exclude closed rooms (safety net — query should already filter these)
                    if (room.state == com.shyden.shytalk.core.model.RoomState.CLOSED) return@filter false
                    if (room.ownerId in myBlockedUserIds) return@filter false
                    val ownerUser = userCache[room.ownerId]
                    if (ownerUser != null && userId in ownerUser.blockedUserIds) return@filter false
                    true
                }.sortedByDescending { it.participantIds.contains(userId) || it.ownerId == userId }

        // Reuse seated user IDs, narrowing to filtered rooms only
        val filteredRoomIds = filtered.map { it.roomId }.toSet()
        val filteredSeatedUserIds =
            if (filteredRoomIds.size == allRooms.size) {
                seatedUserIds // No rooms were filtered out, reuse the set
            } else {
                filtered
                    .flatMap { room ->
                        room.seats.values
                            .filter { it.state == SeatState.OCCUPIED && it.userId != null }
                            .mapNotNull { it.userId }
                    }.toSet()
            }

        _uiState.update {
            it.copy(
                rooms = filtered,
                isLoading = false,
                seatUsers = userCache.filterKeys { key -> key in filteredSeatedUserIds },
            )
        }
    }

    companion object {
        private const val TAG = "HomeViewModel"
        const val REFRESH_INTERVAL_MS = 300_000L
    }

    fun createRoom(name: String) {
        val userId = authRepository.currentUserId ?: return
        logI(TAG, "Creating room: name=$name")
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null, lastRoomName = name) }
            launch { userRepository.updateProfile(userId, mapOf("lastRoomName" to name)) }
            // Close old rooms BEFORE creating new one to avoid race where the
            // closeAll query picks up the newly-created room and closes it.
            roomRepository.closeAllRoomsByOwner(userId)

            // Safety check: verify no active room remains after close attempt.
            // This prevents duplicate rooms from race conditions or failed closes.
            val existingRoomId = roomRepository.findActiveRoomByOwner(userId)
            if (existingRoomId != null) {
                logE(TAG, "Active room still exists after close attempt: $existingRoomId")
                _uiState.update { it.copy(isLoading = false, error = "You already have an active room") }
                return@launch
            }

            when (val result = roomRepository.createRoom(name, userId)) {
                is Resource.Success -> {
                    logI(TAG, "Room created: id=${result.data}")
                    _uiState.update { it.copy(isLoading = false, createdRoomId = result.data) }
                }
                is Resource.Error -> {
                    logE(TAG, "Room creation failed: ${result.message}")
                    _uiState.update { it.copy(isLoading = false, error = result.message) }
                }
                is Resource.Loading -> Unit
            }
        }
    }

    fun onRoomNavigated() {
        _uiState.update { it.copy(createdRoomId = null) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun signOut() {
        logI(TAG, "User signing out")
        authRepository.signOut()
    }
}
