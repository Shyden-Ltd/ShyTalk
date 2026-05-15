package com.shyden.shytalk.feature.home

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.Banner
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.COHORT_MINOR
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.effectiveCohort
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.BannerRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.CancellationException
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
    val showReplaceRoomConfirmation: Boolean = false,
    val pendingRoomName: String? = null,
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
            } catch (e: CancellationException) {
                throw e
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
                    val viewer = userCache[currentUserId]
                    _uiState.update { state ->
                        // UK OSA #17 PR 12 — re-apply the seat-user
                        // cohort redaction after every user-update so a
                        // mid-session cohort flip (admin override / age-
                        // up) immediately drops the user from the seat
                        // map. Without this, a cross-cohort identity
                        // would linger on the home screen until the
                        // next manual refresh.
                        val nextMap =
                            state.seatUsers.let { map ->
                                if (updatedUser.uid in map) map + (updatedUser.uid to updatedUser) else map
                            }
                        state.copy(
                            seatUsers = viewer?.let { redactCrossCohortSeatUsers(nextMap, it) } ?: nextMap,
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

        // Collect all user IDs we need: owners + seated users (lazy sequences).
        // The viewer's own User is fetched via a separate getUser(userId) call
        // below — keeping it off the batch path avoids an extra getUsers call
        // during the init-time empty-rooms pass that pinned existing test
        // assertions on the exact `getUsers` invocation count.
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

        // UK OSA #17 PR 12 — guarantee the viewer's User is cached
        // before the cohort gate runs. A viewer browsing rooms without
        // owning or sitting in any won't be present in the batch fetch
        // above, so we fall back to a direct getUser(userId) here.
        // Without this fallback, the cohort gate fails closed and the
        // user would see an empty home screen on every cold start.
        if (userId !in userCache) {
            when (val result = userRepository.getUser(userId)) {
                is Resource.Success -> cacheUser(userId, result.data)
                else -> Unit
            }
        }

        // UK OSA #17 PR 12 — client-side defence-in-depth cohort gate.
        // Server already filters cross-cohort rooms out of the active
        // listing; this guard catches stale offline-cache rooms and
        // deep-linked rooms that bypassed the listing filter.
        // Fail-CLOSED when the viewer's User doc cannot be resolved
        // (batch + getUser fallback both failed). The same fail-closed
        // posture is used by ConversationListViewModel.loadConversation
        // Details for OSA consistency: a minor viewer must never see
        // adult rooms, even on a transient Firestore hiccup.
        val viewerUser = userCache[userId]
        val cohortGated =
            if (viewerUser == null) {
                logW(TAG, "Cohort gate fail-closed — viewer User not resolvable; emitting empty room list")
                emptyList()
            } else {
                filterRoomsByCohort(allRooms, viewerUser, userCache)
            }

        val filtered =
            cohortGated
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

        // Redact cross-cohort seat users — defence-in-depth so any
        // mid-session cohort flip (admin override, age-up) does not
        // expose foreign-cohort identities to the viewer.
        val filteredSeatUsers = userCache.filterKeys { key -> key in filteredSeatedUserIds }
        val redactedSeatUsers =
            if (viewerUser != null) {
                redactCrossCohortSeatUsers(filteredSeatUsers, viewerUser)
            } else {
                filteredSeatUsers
            }

        _uiState.update {
            it.copy(
                rooms = filtered,
                isLoading = false,
                seatUsers = redactedSeatUsers,
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
            // Check if user already has an active room — ask before replacing
            val existingRoomId = roomRepository.findActiveRoomByOwner(userId)
            if (existingRoomId != null) {
                logI(TAG, "User has existing room $existingRoomId — showing confirmation")
                _uiState.update {
                    it.copy(showReplaceRoomConfirmation = true, pendingRoomName = name)
                }
                return@launch
            }
            doCreateRoom(name, userId)
        }
    }

    fun confirmReplaceRoom() {
        val userId = authRepository.currentUserId ?: return
        val name = _uiState.value.pendingRoomName ?: return
        _uiState.update { it.copy(showReplaceRoomConfirmation = false, pendingRoomName = null) }
        viewModelScope.launch {
            roomRepository.closeAllRoomsByOwner(userId)
            doCreateRoom(name, userId)
        }
    }

    fun cancelReplaceRoom() {
        _uiState.update { it.copy(showReplaceRoomConfirmation = false, pendingRoomName = null) }
    }

    private suspend fun doCreateRoom(
        name: String,
        userId: String,
    ) {
        _uiState.update { it.copy(isLoading = true, error = null, lastRoomName = name) }
        viewModelScope.launch { userRepository.updateProfile(userId, mapOf("lastRoomName" to name)) }

        // UK OSA #17 PR 7 — fetch the caller's cohort to stamp on the
        // new room. The firestore.rules layer binds this value to the
        // server-signed JWT claim, so a client cannot create a room
        // tagged with the wrong cohort. We fall back to "minor" if the
        // user lookup fails: most-restrictive default per the OSA
        // "fail closed when ambiguous" rule.
        //
        // `cohortOverride` (admin-set) takes precedence over `cohort`
        // — the JWT claim is server-minted from `effectiveCohort`
        // which honours the override, so the stamped value MUST match
        // or the firestore.rules create-bind rejects.
        // UK OSA #17 PR 12 — route through the central
        // `User.effectiveCohort` extension so an invalid `cohort` field
        // also fails closed to "minor" (the prior inline check honoured
        // override but accepted any `cohort` string, even a corrupted
        // Firestore value, which would be rejected by the rules-layer
        // create-bind and surface as a confusing error to the user).
        val cohort =
            when (val userResult = userRepository.getUser(userId)) {
                is Resource.Success -> userResult.data.effectiveCohort
                else -> COHORT_MINOR
            }

        when (val result = roomRepository.createRoom(name, userId, cohort)) {
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

    fun onRoomNavigated() {
        _uiState.update { it.copy(createdRoomId = null) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun signOut() {
        logI(TAG, "User signing out")
        // Catch + log so an exception isn't swallowed silently by viewModelScope's
        // default handler. Rethrow CancellationException so structured concurrency
        // remains intact when the scope is cancelled mid-flight.
        viewModelScope.launch {
            try {
                authRepository.signOut()
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                logE(TAG, "authRepository.signOut() failed: ${e.message}", e)
            }
        }
    }
}
