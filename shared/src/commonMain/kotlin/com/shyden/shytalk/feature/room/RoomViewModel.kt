package com.shyden.shytalk.feature.room

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.model.SeatRequestStatus
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.core.ui.effects.AnimationQueue
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.LanguagePreference
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.logD
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.remote.VoiceConnectionState
import com.shyden.shytalk.data.remote.VoiceService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.data.repository.TranslationRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.coroutines.withContext

sealed class BlockWarning {
    data object BlockedByRoomOwner : BlockWarning()

    data object BlockedUserInRoom : BlockWarning()

    data object BlockedByUserInRoom : BlockWarning()

    data class Banned(
        val reason: String?,
        val kickerName: String?,
    ) : BlockWarning()
}

data class RoomClosedSummary(
    val roomName: String,
    val durationMs: Long,
    val hostUsers: List<User>,
    val speakerUsers: List<User>,
    val ownerId: String,
    val totalVisitors: Int,
)

sealed class SeatActionStatus {
    data object Idle : SeatActionStatus()

    data class Loading(
        val message: String,
    ) : SeatActionStatus()

    data class Success(
        val message: String,
    ) : SeatActionStatus()
}

data class RoomUiState(
    val room: ChatRoom? = null,
    val messages: List<Message> = emptyList(),
    val currentUserId: String = "",
    val currentUserName: String = "",
    val currentRole: RoomRole = RoomRole.ATTENDEE,
    val isLoading: Boolean = true,
    val error: String? = null,
    val roomClosed: Boolean = false,
    val roomClosedSummary: RoomClosedSummary? = null,
    val ownerAwayRemainingMs: Long = 0L,
    val roomExpiryRemainingMs: Long = 0L,
    val speakingUserIds: Set<String> = emptySet(),
    val isVoiceJoined: Boolean = false,
    val isVoiceReady: Boolean = false,
    val isVoiceUnavailable: Boolean = false,
    val voiceErrorDetail: String? = null,
    val pendingInvite: String? = null,
    val seatUsers: Map<String, User> = emptyMap(),
    val participantUsers: Map<String, User> = emptyMap(),
    val allKnownUsers: Map<String, User> = emptyMap(),
    val blockedUserIds: Set<String> = emptySet(),
    val blockWarning: BlockWarning? = null,
    val hasJoined: Boolean = false,
    val shouldNavigateBack: Boolean = false,
    val wasKicked: Boolean = false,
    val hasAudioPermission: Boolean = false,
    val activeNotification: RoomNotification? = null,
    val pendingRequestsForPanel: List<SeatRequest> = emptyList(),
    val kickedByName: String? = null,
    val kickReason: String? = null,
    val disconnectedUserIds: Set<String> = emptySet(),
    val seatActionStatus: SeatActionStatus = SeatActionStatus.Idle,
    val isSubmittingReport: Boolean = false,
    val reportSubmitted: Boolean = false,
    val reportError: String? = null,
    val editingMessageId: String? = null,
    val editingMessageText: String = "",
    val aliases: Map<String, String> = emptyMap(),
    val maxRoomDurationMs: Long = Constants.MAX_ROOM_DURATION_MS,
    val showExpiryUpsellDialog: Boolean = false,
    val effectiveSeatCount: Int = Constants.MAX_SEATS,
    val translations: Map<String, String> = emptyMap(),
)

class RoomViewModel(
    private val roomId: String,
    private val roomRepository: RoomRepository,
    private val messageRepository: MessageRepository,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val seatRequestRepository: SeatRequestRepository,
    private val voiceService: VoiceService,
    private val presenceService: PresenceService,
    private val roomLifecycleManager: RoomLifecycleManager,
    private val reportRepository: ReportRepository,
    private val storageRepository: StorageRepository,
    private val economyRepository: EconomyRepository,
    private val translationRepository: TranslationRepository? = null,
) : ViewModel() {
    companion object {
        private const val TAG = "RoomViewModel"
        private const val VOICE_CONNECT_TIMEOUT_MS = 10_000L
    }

    private val _uiState = MutableStateFlow(RoomUiState())
    val uiState: StateFlow<RoomUiState> = _uiState.asStateFlow()

    private var ownerAwayCountdownJob: Job? = null
    private var roomExpiryCountdownJob: Job? = null
    private var isSeated = false

    // All accesses are on Dispatchers.Main via viewModelScope — safe without synchronization
    private val userCache: MutableMap<String, User> = mutableMapOf()
    private var isBlockCheckDone = false

    @kotlin.concurrent.Volatile private var firstJoinTimestamp: Long? = null
    private var allMessages: List<Message> = emptyList()
    private var lastKnownRoom: ChatRoom? = null
    private var isOwnerReturnTriggered = false
    private var lastSeatedUserIds: Set<String> = emptySet()
    private var lastParticipantIds: Set<String> = emptySet()
    private var lastOwnerAwayState: Pair<RoomState, Long?>? = null
    private var lastFilteredMessages: List<Message> = emptyList()
    private var seatActionResetJob: Job? = null
    private var hasAutoRejoinAttempted = false
    private var userObserverJob: Job? = null
    private var observedUserIds: Set<String> = emptySet()
    private var hasExpiryUpsellShown = false
    private val autoTranslatedMessageIds = mutableSetOf<String>()

    // Gift animation queue — room-wide gift events
    val giftAnimationQueue = AnimationQueue()
    private var lastGiftEventTimestamp: Long = 0L

    // Message flood protection
    private val recentMessageTimestamps = ArrayDeque<Long>()

    // Notification queue state
    private val notificationQueue = mutableListOf<RoomNotification>()
    private var autoDismissJob: Job? = null
    private val processedRequestIds = mutableSetOf<String>()
    private val processedApprovalIds = mutableSetOf<String>()
    private var rawPendingRequests: List<SeatRequest> = emptyList()
    private val locallyApprovedRequestIds = mutableSetOf<String>()

    // Tracks sender IDs we've already fetched users for — must be declared before init
    // because observeMessages() is called in init and may fire synchronously on Dispatchers.Main.immediate
    private val knownSenderIds = mutableSetOf<String>()

    init {
        val userId = authRepository.currentUserId ?: ""
        _uiState.value =
            _uiState.value.copy(
                currentUserId = userId,
                isVoiceReady = voiceService.connectionState.value == VoiceConnectionState.CONNECTED,
            )
        loadUserName()
        loadBlockedUsers()
        loadAliases()
        observeRoom()
        observeMessages()
        observeVoiceState()
        observeDisconnectedUsers()
        observePendingRequests()
        observeMyRequest()
        observeUserUpdates()
        observeEconomyConfig()
    }

    private fun observeUserUpdates() {
        viewModelScope.launch {
            userRepository.userUpdates.collect { updatedUser ->
                val uid = updatedUser.uid
                if (uid in userCache) {
                    userCache[uid] = updatedUser
                    _uiState.update { state ->
                        state.copy(
                            seatUsers = state.seatUsers.replaceUser(updatedUser),
                            participantUsers = state.participantUsers.replaceUser(updatedUser),
                            allKnownUsers = state.allKnownUsers.replaceUser(updatedUser),
                            currentUserName = if (uid == state.currentUserId) updatedUser.displayName else state.currentUserName,
                        )
                    }
                    // Re-resolve room duration/seat limit if the room owner's Super Shy status changed
                    val room = _uiState.value.room
                    if (room != null && uid == room.ownerId) {
                        resolveRoomDuration()
                        resolveSeatLimit()
                    }
                }
            }
        }
    }

    private var lastEconomyConfig: com.shyden.shytalk.core.model.EconomyConfig? = null

    private fun observeEconomyConfig() {
        viewModelScope.launch {
            economyRepository
                .observeEconomyConfig()
                .catch { e -> logE(TAG, "observeEconomyConfig error", e) }
                .collect { config ->
                    lastEconomyConfig = config
                    resolveRoomDuration()
                    resolveSeatLimit()
                }
        }
    }

    private fun resolveRoomDuration() {
        val config = lastEconomyConfig ?: return
        val room = _uiState.value.room ?: return
        val ownerUser = _uiState.value.allKnownUsers[room.ownerId]
        val isSuperShy = ownerUser?.isSuperShy == true
        val durationMinutes =
            if (isSuperShy) {
                config.superShyRoomDurationMinutes
            } else {
                config.maxRoomDurationMinutes
            }
        val durationMs = durationMinutes.toLong() * 60 * 1000
        _uiState.update { it.copy(maxRoomDurationMs = durationMs) }

        // If duration increased (e.g. owner is Super Shy) and room is no longer near expiry,
        // cancel any premature countdown/upsell that fired before user data loaded
        val elapsed = currentTimeMillis() - room.createdAt
        val remaining = durationMs - elapsed
        if (remaining > Constants.ROOM_EXPIRY_COUNTDOWN_THRESHOLD_MS && roomExpiryCountdownJob?.isActive == true) {
            roomExpiryCountdownJob?.cancel()
            roomExpiryCountdownJob = null
            hasExpiryUpsellShown = false
            _uiState.update { it.copy(showExpiryUpsellDialog = false, roomExpiryRemainingMs = 0L) }
        }
    }

    private fun resolveSeatLimit() {
        val config = lastEconomyConfig ?: return
        val room = _uiState.value.room ?: return
        val ownerUser = _uiState.value.allKnownUsers[room.ownerId]
        val isSuperShy = ownerUser?.isSuperShy == true
        val count =
            if (isSuperShy) {
                Constants.MAX_SEATS
            } else {
                config.normalSeatCount.coerceIn(1, Constants.MAX_SEATS)
            }
        _uiState.update { it.copy(effectiveSeatCount = count) }
    }

    private fun Map<String, User>.replaceUser(user: User): Map<String, User> = if (user.uid in this) this + (user.uid to user) else this

    @Suppress("kotlin:S3776")
    private fun observeRemoteUserChanges(userIds: Set<String>) {
        if (userIds == observedUserIds) return
        observedUserIds = userIds
        userObserverJob?.cancel()
        if (userIds.isEmpty()) return
        userObserverJob =
            viewModelScope.launch {
                userRepository
                    .observeUsers(userIds)
                    .catch { e -> logE(TAG, "observeRemoteUserChanges error", e) }
                    .collect { updatedUser ->
                        val uid = updatedUser.uid
                        val cached = userCache[uid]
                        if (cached != null && cached != updatedUser) {
                            userCache[uid] = updatedUser
                            _uiState.update { state ->
                                state.copy(
                                    seatUsers = state.seatUsers.replaceUser(updatedUser),
                                    participantUsers = state.participantUsers.replaceUser(updatedUser),
                                    allKnownUsers = state.allKnownUsers.replaceUser(updatedUser),
                                    currentUserName = if (uid == state.currentUserId) updatedUser.displayName else state.currentUserName,
                                )
                            }
                            // Re-resolve room limits if the owner's SuperShy status changed
                            val room = _uiState.value.room
                            if (room != null && uid == room.ownerId && cached.isSuperShy != updatedUser.isSuperShy) {
                                resolveRoomDuration()
                                resolveSeatLimit()
                            }
                        }
                    }
            }
    }

    private fun collectRoomUserIds(
        room: ChatRoom,
        currentUserId: String,
    ): Set<String> {
        val seatUserIds =
            room.seats.values
                .asSequence()
                .filter { it.state == SeatState.OCCUPIED && it.userId != null }
                .mapNotNull { it.userId }
                .toSet()
        return (seatUserIds + room.participantIds).filter { it != currentUserId }.toSet()
    }

    private fun loadUserName() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            when (val result = userRepository.getUser(userId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(currentUserName = result.data.displayName) }
                }

                else -> Unit
            }
        }
    }

    private fun observeRoom() {
        // Instant re-entry: seed ViewModel user cache from the shared cache that
        // survives ViewModel destruction, then process cached room data immediately.
        val sharedUsers = roomLifecycleManager.sharedUserCache
        if (sharedUsers.isNotEmpty()) {
            userCache.putAll(sharedUsers)
        }

        val cached = roomLifecycleManager.activeRoom.value
        if (cached != null && cached.roomId == roomId && cached.state != RoomState.CLOSED) {
            // Also seed messages from ActiveRoomManager so the chat is visible instantly
            val cachedMessages = roomLifecycleManager.activeMessages.value
            if (cachedMessages.isNotEmpty()) {
                allMessages = cachedMessages
                updateFilteredMessages()
            }
            processRoomEmission(cached)
        }

        viewModelScope.launch {
            roomRepository
                .getRoomFlow(roomId)
                .catch { e ->
                    _uiState.update { it.copy(isLoading = false, error = e.message) }
                }.collect { room -> processRoomEmission(room) }
        }
    }

    private fun processRoomEmission(room: ChatRoom?) {
        if (room == null || room.state == RoomState.CLOSED) {
            handleRoomClosed(room)
            return
        }

        lastKnownRoom = room
        val userId = _uiState.value.currentUserId

        if (_uiState.value.hasJoined && handleKickedOrRemoved(room, userId)) {
            return
        }

        val role = room.resolveRole(userId)

        if (!isBlockCheckDone && !_uiState.value.hasJoined) {
            handleFirstJoin(room, userId, role)
            return
        }

        handleOwnerReturnDetection(room, userId)
        handleNormalUpdate(room, userId, role)
    }

    private fun handleRoomClosed(room: ChatRoom?) {
        disconnectFromRoom()

        viewModelScope.launch {
            // Fetch host and speaker user data so the summary can display them
            if (room != null) {
                val allSummaryIds = room.allTimeHostIds + room.allTimeSeatUserIds + room.ownerId
                val uncachedIds = allSummaryIds.filter { it !in userCache }
                if (uncachedIds.isNotEmpty()) {
                    when (val result = userRepository.getUsers(uncachedIds)) {
                        is Resource.Success -> result.data.forEach { user -> userCache[user.uid] = user }
                        else -> Unit
                    }
                }
            }
            val summary = buildClosedSummary(room)
            _uiState.update { it.copy(isLoading = false, roomClosed = true, roomClosedSummary = summary) }
        }
    }

    private fun disconnectFromRoom() {
        voiceService.leaveChannel()
        presenceService.removePresence()
        roomLifecycleManager.untrackRoom()
        val userId = _uiState.value.currentUserId
        viewModelScope.launch {
            userRepository.updateProfile(userId, mapOf("currentRoomId" to null))
        }
    }

    /** Returns true if user was kicked/removed and collection should stop. */
    private fun handleKickedOrRemoved(
        room: ChatRoom,
        userId: String,
    ): Boolean {
        if (userId in room.bannedUserIds) {
            disconnectFromRoom()
            val info = room.kickInfo[userId]
            _uiState.update {
                it.copy(
                    isLoading = false,
                    wasKicked = true,
                    kickedByName = info?.get("kickerName"),
                    kickReason = info?.get("reason") ?: "No reason given",
                )
            }
            return true
        }
        if (userId !in room.participantIds) {
            // If not banned and room is active, attempt one auto-rejoin
            // (handles race between join write and stale Firestore emission)
            if (!hasAutoRejoinAttempted && room.state == RoomState.ACTIVE) {
                hasAutoRejoinAttempted = true
                logW(TAG, "User not in participantIds but not banned — attempting auto-rejoin")
                viewModelScope.launch {
                    // Check if the current user was suspended — if so, don't rejoin
                    try {
                        val result = userRepository.getUser(userId)
                        if (result is Resource.Success && result.data.isActivelySuspended) {
                            logW(TAG, "User is suspended — aborting auto-rejoin")
                            disconnectFromRoom()
                            _uiState.update { it.copy(isLoading = false, shouldNavigateBack = true) }
                            return@launch
                        }
                    } catch (e: CancellationException) {
                        throw e
                    } catch (e: Exception) {
                        logE(TAG, "Failed to check suspension during auto-rejoin", e)
                    }
                    roomRepository.joinRoom(roomId, userId)
                    presenceService.setPresence(roomId, userId)
                }
                return false
            }
            disconnectFromRoom()
            _uiState.update { it.copy(isLoading = false, shouldNavigateBack = true) }
            return true
        }
        hasAutoRejoinAttempted = false
        return false
    }

    @Suppress("kotlin:S3776")
    private fun handleFirstJoin(
        room: ChatRoom,
        userId: String,
        role: RoomRole,
    ) {
        isBlockCheckDone = true

        // Detect "already joined" state (ViewModel recreated after back navigation)
        val alreadyInRoom = userId in room.participantIds && roomLifecycleManager.isInRoom(roomId)
        if (alreadyInRoom) {
            _uiState.update { it.copy(room = room, currentRole = role, isLoading = false, hasJoined = true) }
            refilterPendingRequests()
            // Track seat state so handleNormalUpdate detects transitions correctly
            isSeated = room.findUserSeat(userId) != null
            // Rejoin voice if not already connected (ViewModel recreated)
            if (room.voiceRoomName.isNotEmpty() && !voiceService.isJoined.value) {
                viewModelScope.launch {
                    voiceService.joinRoom(room.voiceRoomName, userId)
                    // Sync mic and audio mode to seat's mute state after joining
                    val mySeat = room.findUserSeat(userId)?.value
                    val shouldUnmute = mySeat != null && !mySeat.isMuted
                    voiceService.setMicrophoneEnabled(shouldUnmute)
                    voiceService.setAudioMode(shouldUnmute)
                }
                // Timeout: unblock room if voice doesn't connect in time
                viewModelScope.launch {
                    delay(VOICE_CONNECT_TIMEOUT_MS)
                    if (!_uiState.value.isVoiceReady) {
                        _uiState.update { it.copy(isVoiceReady = true, isVoiceUnavailable = true) }
                    }
                }
            }
            // Detect owner return on first emission — without this, the ViewModel
            // waits for a second Firestore emission that may never come.
            handleOwnerReturnDetection(room, userId)
            roomLifecycleManager.updateTrackedRoom(room)
            loadSeatUsers(room)
            loadParticipantUsers(room)
            observeRemoteUserChanges(collectRoomUserIds(room, userId))
            handleOwnerAwayCountdown(room)
            resolveRoomDuration()
            handleRoomExpiryCountdown(room)
            return
        }

        // Re-entry: user is in participantIds but lifecycle manager is not tracking
        // (e.g., app was backgrounded, process killed, or previous session cleaned up).
        // Treat as a completely new session — skip block dialogs, join fresh.
        val isReEntry = userId in room.participantIds && !roomLifecycleManager.isInRoom(roomId)
        if (isReEntry) {
            _uiState.update { it.copy(room = room, currentRole = role, isLoading = false) }
            joinRoom()
            roomLifecycleManager.updateTrackedRoom(room)
            loadSeatUsers(room)
            loadParticipantUsers(room)
            observeRemoteUserChanges(collectRoomUserIds(room, userId))
            handleOwnerAwayCountdown(room)
            resolveRoomDuration()
            handleRoomExpiryCountdown(room)
            // Owner re-entering OWNER_AWAY room
            if (room.ownerId == userId && room.state == RoomState.OWNER_AWAY) {
                isOwnerReturnTriggered = true
                ownerReturn()
            }
            return
        }

        _uiState.update { it.copy(room = room, currentRole = role, isLoading = false) }
        if (room.ownerId == userId) {
            joinRoom()
        } else {
            checkBlockConflicts(room)
        }
        roomLifecycleManager.updateTrackedRoom(room)
        loadSeatUsers(room)
        loadParticipantUsers(room)
        observeRemoteUserChanges(collectRoomUserIds(room, userId))
        handleOwnerAwayCountdown(room)
        resolveRoomDuration()
        handleRoomExpiryCountdown(room)

        // Owner re-entering an OWNER_AWAY room — trigger return immediately.
        // handleOwnerReturnDetection won't fire here because hasJoined/isInRoom
        // are still false, and the Firestore writes in joinRoom() are no-ops
        // (owner already in participantIds), so no second emission arrives.
        if (room.ownerId == userId && room.state == RoomState.OWNER_AWAY) {
            isOwnerReturnTriggered = true
            ownerReturn()
        }
    }

    private fun handleOwnerReturnDetection(
        room: ChatRoom,
        userId: String,
    ) {
        if (room.ownerId != userId || !_uiState.value.hasJoined) return

        // Self-heal: if owner is online but somehow not in seat 0, restore immediately
        val ownerInSeat0 = room.seats[Constants.OWNER_SEAT_INDEX.toString()]?.isOccupiedBy(userId) == true
        if (!ownerInSeat0 && roomLifecycleManager.isInRoom(roomId) && !isOwnerReturnTriggered) {
            logW(TAG, "Owner self-heal: not in seat 0, restoring via setOwnerReturned")
            isOwnerReturnTriggered = true
            ownerReturn()
            return
        }

        if (room.state == RoomState.OWNER_AWAY &&
            !isOwnerReturnTriggered &&
            roomLifecycleManager.isInRoom(roomId)
        ) {
            isOwnerReturnTriggered = true
            ownerReturn()
        }
        if (room.state == RoomState.ACTIVE) {
            isOwnerReturnTriggered = false
        }
    }

    private fun handleNormalUpdate(
        room: ChatRoom,
        userId: String,
        role: RoomRole,
    ) {
        val mySeat = room.findUserSeat(userId)?.value
        val currentlySeated = mySeat != null
        val hasAudio = _uiState.value.hasAudioPermission

        // When becoming seated: do NOT enable mic. User starts muted (Bug #6).
        if (currentlySeated != isSeated && !currentlySeated) {
            logD(TAG, "User left seat, disabling mic")
            voiceService.setMicrophoneEnabled(false)
            voiceService.setAudioMode(false)
        }
        isSeated = currentlySeated

        if (mySeat != null) {
            // Sync mute state and audio mode to seat's isMuted
            val shouldUnmute = !mySeat.isMuted
            voiceService.setMicrophoneEnabled(shouldUnmute)
            voiceService.setAudioMode(shouldUnmute)

            // Ensure connected to voice room
            if (!voiceService.isJoined.value && hasAudio && room.voiceRoomName.isNotEmpty()) {
                viewModelScope.launch {
                    voiceService.joinRoom(room.voiceRoomName, userId)
                    // Re-sync after connection established
                    voiceService.setMicrophoneEnabled(shouldUnmute)
                    voiceService.setAudioMode(shouldUnmute)
                }
            }
        }

        val pendingInvite = room.pendingInvites[userId]
        if (pendingInvite != null && _uiState.value.pendingInvite == null) {
            enqueueNotification(RoomNotification.InviteReceived(pendingInvite))
        }

        val joinTs = room.firstJoinTimestamps[userId]
        if (joinTs != null && firstJoinTimestamp == null) {
            firstJoinTimestamp = joinTs
            updateFilteredMessages()
        }

        _uiState.update {
            it.copy(
                room = room,
                currentRole = role,
                isLoading = false,
                pendingInvite = pendingInvite,
            )
        }

        roomLifecycleManager.updateTrackedRoom(room)
        loadSeatUsers(room)
        loadParticipantUsers(room)
        observeRemoteUserChanges(collectRoomUserIds(room, _uiState.value.currentUserId))
        closeOwnerAwayIfSeatsEmpty(room)
        handleOwnerAwayCountdown(room)
        refilterPendingRequests()
        handleGiftEvent(room)
    }

    private fun handleGiftEvent(room: ChatRoom) {
        val event = room.lastGiftEvent ?: return
        if (lastGiftEventTimestamp == 0L) {
            // First observation — skip only if event is old (>10s), otherwise play it
            lastGiftEventTimestamp = event.timestamp
            val now =
                com.shyden.shytalk.core.util
                    .currentTimeMillis()
            if (now - event.timestamp > 10_000) return
        } else {
            if (event.timestamp <= lastGiftEventTimestamp) return
            lastGiftEventTimestamp = event.timestamp
        }
        // Respect per-user animation filter
        val minValue = userCache[_uiState.value.currentUserId]?.minGiftAnimationValue ?: 0
        if (event.coinValue < minValue) return
        giftAnimationQueue.enqueue(event)
    }

    @Suppress("kotlin:S3776")
    private fun checkBlockConflicts(room: ChatRoom) {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val myBlockedIds = _uiState.value.blockedUserIds

            // Check if user is banned from this room (kicked previously)
            if (userId in room.bannedUserIds) {
                val kickInfo = room.kickInfo[userId]
                _uiState.update {
                    it.copy(
                        blockWarning =
                            BlockWarning.Banned(
                                reason = kickInfo?.get("reason"),
                                kickerName = kickInfo?.get("kickerName"),
                            ),
                    )
                }
                return@launch
            }

            // Always check room owner's block list (even if owner is away)
            val ownerUser =
                userCache[room.ownerId] ?: when (val result = userRepository.getUser(room.ownerId)) {
                    is Resource.Success -> {
                        userCache[room.ownerId] = result.data
                        result.data
                    }

                    else -> null
                }
            if (ownerUser != null && userId in ownerUser.blockedUserIds) {
                _uiState.update { it.copy(blockWarning = BlockWarning.BlockedByRoomOwner) }
                return@launch
            }

            // Check if any participant is blocked by me
            val blockedInRoom = room.participantIds.any { it in myBlockedIds && it != userId }
            if (blockedInRoom) {
                _uiState.update { it.copy(blockWarning = BlockWarning.BlockedUserInRoom) }
                return@launch
            }

            // Check if any other participant (non-owner) has blocked me — single batch call
            val otherParticipantIds = room.participantIds.filter { it != userId && it != room.ownerId }
            if (otherParticipantIds.isNotEmpty()) {
                val result = userRepository.checkBlockedBy(otherParticipantIds, userId)
                if (result is Resource.Success && result.data.isNotEmpty()) {
                    _uiState.update { it.copy(blockWarning = BlockWarning.BlockedByUserInRoom) }
                    return@launch
                }
            }

            // No conflicts, join directly
            joinRoom()
        }
    }

    fun confirmJoinDespiteBlock() {
        _uiState.update { it.copy(blockWarning = null) }
        joinRoom()
    }

    fun cancelJoin() {
        _uiState.update { it.copy(shouldNavigateBack = true) }
    }

    private fun observeMessages() {
        viewModelScope.launch {
            messageRepository
                .getMessages(roomId)
                .catch { e -> logW(TAG, "observeMessages error", e) }
                .collect { messages ->
                    allMessages = messages
                    updateFilteredMessages()
                }
        }
    }

    private fun updateFilteredMessages() {
        val ts = firstJoinTimestamp
        val filtered =
            if (ts != null) {
                allMessages.filter { it.createdAt >= ts }
            } else {
                allMessages
            }
        if (filtered !== lastFilteredMessages) {
            lastFilteredMessages = filtered
            _uiState.update { it.copy(messages = filtered) }
            loadMessageSenderUsers(filtered)
            autoTranslateNewMessages(filtered)
        }
    }

    private fun loadMessageSenderUsers(messages: List<Message>) {
        val senderIds = messages.mapTo(mutableSetOf()) { it.senderId }
        senderIds.remove("system")
        val newIds = senderIds - knownSenderIds
        if (newIds.isEmpty()) return
        knownSenderIds.addAll(newIds)
        loadUsersForIds(newIds) { /* accumulateKnownUsers handles the UI update */ }
    }

    @Suppress("kotlin:S3776")
    private fun observeVoiceState() {
        viewModelScope.launch {
            combine(
                voiceService.speakingUsers,
                voiceService.isJoined,
                voiceService.error,
            ) { speaking, joined, errorMsg ->
                Triple(speaking, joined, errorMsg)
            }.distinctUntilChanged()
                .collect { (speaking, joined, errorMsg) ->
                    val isUnavailable = _uiState.value.isVoiceUnavailable
                    _uiState.update {
                        it.copy(
                            speakingUserIds = if (isUnavailable) emptySet() else speaking,
                            isVoiceJoined = joined,
                            // Don't set voice errors in main error field — the voice
                            // unavailable banner handles display. Avoids double error.
                        )
                    }
                    // Voice error — show the banner with diagnostic detail
                    if (errorMsg != null) {
                        _uiState.update {
                            it.copy(
                                isVoiceReady = true,
                                isVoiceUnavailable = true,
                                voiceErrorDetail = errorMsg,
                                speakingUserIds = emptySet(),
                            )
                        }
                        voiceService.clearError()
                    }
                }
        }
        // Latch isVoiceReady — once connected, never hide the room again
        viewModelScope.launch {
            voiceService.connectionState.collect { connState ->
                if (connState == VoiceConnectionState.CONNECTED) {
                    _uiState.update { it.copy(isVoiceReady = true, isVoiceUnavailable = false) }
                } else if (connState == VoiceConnectionState.DISCONNECTED && _uiState.value.isVoiceReady) {
                    _uiState.update { it.copy(isVoiceUnavailable = true, speakingUserIds = emptySet()) }
                }
            }
        }
    }

    private fun observeDisconnectedUsers() {
        viewModelScope.launch {
            roomLifecycleManager.disconnectedUserIds.collect { ids ->
                _uiState.update { it.copy(disconnectedUserIds = ids) }
            }
        }
    }

    @Suppress("kotlin:S3776")
    private fun joinRoom() {
        viewModelScope.launch {
            logI(TAG, "Joining room: roomId=$roomId")
            // Wait for any pending leave cleanup to finish before joining
            roomLifecycleManager.awaitLeaveCompletion(roomId)

            val userId = _uiState.value.currentUserId
            val room = _uiState.value.room

            // Already in this room (e.g., returned after pressing back)
            if (room != null && userId in room.participantIds && roomLifecycleManager.isInRoom(roomId)) {
                _uiState.update { it.copy(hasJoined = true) }
                refilterPendingRequests()
                roomLifecycleManager.trackRoom(roomId)
                return@launch
            }

            // Ensure user name is loaded before sending join message
            if (_uiState.value.currentUserName.isEmpty()) {
                when (val result = userRepository.getUser(userId)) {
                    is Resource.Success -> {
                        _uiState.update { it.copy(currentUserName = result.data.displayName) }
                    }

                    else -> Unit
                }
            }
            val userName = _uiState.value.currentUserName

            // Mute setup if already seated (owner re-entering)
            val voiceRoom = room?.voiceRoomName
            if (!voiceRoom.isNullOrEmpty()) {
                val seatEntry = room.findUserSeat(userId)
                if (seatEntry != null) {
                    isSeated = true
                    if (!seatEntry.value.isMuted) {
                        roomRepository.toggleMute(roomId, seatEntry.key.toInt(), true)
                    }
                }
            }

            _uiState.update { it.copy(hasJoined = true) }
            refilterPendingRequests()

            // Start foreground service via RoomLifecycleManager
            roomLifecycleManager.trackRoom(roomId)

            // Run all independent operations in parallel for faster room join
            // Firestore room writes (sequential — same document)
            // joinRoom MUST come before recordFirstJoinTimestamp because joinRoom
            // adds the user to participantIds, which is required by Firestore
            // security rules before they can write to firstJoinTimestamps.
            launch {
                try {
                    roomRepository.leaveAllRooms(userId, exceptRoomId = roomId)
                    roomRepository.joinRoom(roomId, userId)
                    roomRepository.recordFirstJoinTimestamp(roomId, userId)
                } catch (e: CancellationException) {
                    throw e
                } catch (e: Exception) {
                    logE(TAG, "Failed to join room: ${e.message}")
                }
            }
            // RTDB presence (independent)
            launch { presenceService.setPresence(roomId, userId) }
            // User profile update (different document)
            launch { userRepository.updateProfile(userId, mapOf("currentRoomId" to roomId)) }
            // Voice join — biggest bottleneck, runs in parallel with writes
            if (!voiceRoom.isNullOrEmpty()) {
                launch {
                    voiceService.joinRoom(voiceRoom, userId)
                    voiceService.setMicrophoneEnabled(false)
                    voiceService.setAudioMode(false)
                }
                // Timeout: unblock room if voice doesn't connect in time
                launch {
                    delay(VOICE_CONNECT_TIMEOUT_MS)
                    if (!_uiState.value.isVoiceReady) {
                        _uiState.update { it.copy(isVoiceReady = true, isVoiceUnavailable = true) }
                    }
                }
            } else {
                // No voice room — mark ready so the room UI is shown immediately
                _uiState.update { it.copy(isVoiceReady = true) }
            }
            // Join message (independent)
            if (userName.isNotEmpty()) {
                launch {
                    val result =
                        messageRepository.sendJoinMessage(
                            roomId,
                            userId,
                            userName,
                            "$userName joined the room",
                        )
                    if (result is Resource.Error) {
                        logE(TAG, "sendJoinMessage failed: ${result.message}")
                    }
                }
            }
        }
    }

    /** Close OWNER_AWAY room immediately once all non-owner seats are empty.
     *  Any participant can trigger this — closeRoom is idempotent and the owner
     *  has already left, so their ViewModel won't receive updates to act on. */
    private fun closeOwnerAwayIfSeatsEmpty(room: ChatRoom) {
        if (room.state != RoomState.OWNER_AWAY) return
        if (room.hasSeatedNonOwners()) return

        logD(TAG, "closeOwnerAwayIfSeatsEmpty: no seated non-owners → closeRoom")
        ownerAwayCountdownJob?.cancel()
        viewModelScope.launch {
            roomRepository.closeRoom(roomId)
        }
    }

    private fun handleOwnerAwayCountdown(room: ChatRoom) {
        val newState = room.state to room.ownerLeftAt
        if (newState == lastOwnerAwayState) return
        lastOwnerAwayState = newState

        val leftAt = room.ownerLeftAt
        if (room.state == RoomState.OWNER_AWAY && leftAt != null) {
            ownerAwayCountdownJob?.cancel()
            ownerAwayCountdownJob =
                viewModelScope.launch {
                    while (true) {
                        val elapsed = currentTimeMillis() - leftAt
                        val remaining = Constants.OWNER_LEAVE_TIMEOUT_MS - elapsed
                        if (remaining <= 0) {
                            // Any remaining participant can close an expired OWNER_AWAY room
                            roomRepository.closeRoom(roomId)
                            break
                        }
                        _uiState.update { it.copy(ownerAwayRemainingMs = remaining) }
                        delay(1000L)
                    }
                }
        } else {
            ownerAwayCountdownJob?.cancel()
            _uiState.update { it.copy(ownerAwayRemainingMs = 0L) }
        }
    }

    @Suppress("kotlin:S3776")
    private fun handleRoomExpiryCountdown(room: ChatRoom) {
        if (room.state == RoomState.CLOSED) {
            roomExpiryCountdownJob?.cancel()
            return
        }
        val maxDuration = _uiState.value.maxRoomDurationMs
        val elapsed = currentTimeMillis() - room.createdAt
        val remaining = maxDuration - elapsed

        if (remaining <= Constants.ROOM_EXPIRY_COUNTDOWN_THRESHOLD_MS) {
            if (roomExpiryCountdownJob?.isActive == true) return
            // Show upsell dialog once when countdown starts for non-Super Shy owner
            if (!hasExpiryUpsellShown) {
                hasExpiryUpsellShown = true
                val ownerUser = _uiState.value.allKnownUsers[room.ownerId]
                if (ownerUser?.isSuperShy != true) {
                    _uiState.update { it.copy(showExpiryUpsellDialog = true) }
                }
            }
            roomExpiryCountdownJob =
                viewModelScope.launch {
                    while (true) {
                        val currentMax = _uiState.value.maxRoomDurationMs
                        val now = currentTimeMillis() - room.createdAt
                        val left = currentMax - now
                        if (left <= 0) {
                            if (_uiState.value.currentRole == RoomRole.OWNER) {
                                roomRepository.closeRoom(roomId)
                            }
                            break
                        }
                        _uiState.update { it.copy(roomExpiryRemainingMs = left) }
                        delay(1000L)
                    }
                }
        }
    }

    private fun withSeatAction(
        loadingMessage: String,
        successMessage: String,
        action: suspend () -> Resource<Unit>,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(seatActionStatus = SeatActionStatus.Loading(loadingMessage)) }
            try {
                when (val result = action()) {
                    is Resource.Success -> {
                        seatActionResetJob?.cancel()
                        _uiState.update { it.copy(seatActionStatus = SeatActionStatus.Success(successMessage)) }
                        seatActionResetJob =
                            viewModelScope.launch {
                                delay(1500L)
                                _uiState.update { it.copy(seatActionStatus = SeatActionStatus.Idle) }
                            }
                    }

                    is Resource.Error -> {
                        _uiState.update { it.copy(seatActionStatus = SeatActionStatus.Idle, error = result.message) }
                    }

                    is Resource.Loading -> Unit
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                logE(TAG, "Seat action failed", e)
                _uiState.update { it.copy(seatActionStatus = SeatActionStatus.Idle, error = e.message ?: "Action failed") }
            }
        }
    }

    fun takeSeat(seatIndex: Int) {
        // Block rapid successive taps while a seat action is in flight
        if (_uiState.value.seatActionStatus is SeatActionStatus.Loading) return
        val userId = _uiState.value.currentUserId
        val room = _uiState.value.room ?: return
        val role = _uiState.value.currentRole

        // Owner is locked to seat 0
        if (role == RoomRole.OWNER && seatIndex != Constants.OWNER_SEAT_INDEX) return
        // Non-owners cannot take the owner seat
        if (seatIndex == Constants.OWNER_SEAT_INDEX && role != RoomRole.OWNER) return
        // Reject seats beyond the effective limit
        if (seatIndex >= _uiState.value.effectiveSeatCount) return

        val seat = room.seats[seatIndex.toString()] ?: return
        if (seat.state == SeatState.OCCUPIED) return

        // When seats are locked, attendees cannot request
        if (role == RoomRole.ATTENDEE && room.requireApproval) {
            _uiState.update { it.copy(error = "Seats are locked. You cannot request to sit until the room owner allows it.") }
            return
        }

        // Attendees need approval via seat request
        if (role == RoomRole.ATTENDEE) {
            withSeatAction("Sending request...", "Request sent") {
                seatRequestRepository.createRequest(
                    roomId = roomId,
                    userId = userId,
                    userName = _uiState.value.currentUserName,
                    seatIndex = seatIndex,
                )
            }
            return
        }

        // Hosts can only self-seat when requireApproval is OFF
        if (role == RoomRole.HOST && room.requireApproval) return

        withSeatAction("Taking seat...", "Seated") {
            roomRepository.takeSeat(roomId, seatIndex, userId)
        }
    }

    fun leaveSeat(seatIndex: Int) {
        val userId = _uiState.value.currentUserId
        val room = _uiState.value.room ?: return

        // Owner cannot leave seat 0
        if (seatIndex == Constants.OWNER_SEAT_INDEX && room.ownerId == userId) return

        withSeatAction("Leaving seat...", "Left seat") {
            roomRepository.leaveSeat(roomId, seatIndex)
        }
    }

    fun removeFromSeat(seatIndex: Int) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole
            if (role == RoomRole.ATTENDEE) return@launch

            // Cannot remove from owner seat
            if (seatIndex == Constants.OWNER_SEAT_INDEX) return@launch

            val seat = room.seats[seatIndex.toString()] ?: return@launch
            val targetUserId = seat.userId ?: return@launch

            // Hosts cannot act on owner or other hosts
            val isTargetOwner = targetUserId == room.ownerId
            val isTargetHost = targetUserId in room.hostIds
            if (role == RoomRole.HOST && (isTargetOwner || isTargetHost)) return@launch

            roomRepository.removeFromSeat(roomId, seatIndex)
        }
    }

    fun toggleSelfMute(seatIndex: Int) {
        val room = _uiState.value.room ?: return
        val seat = room.seats[seatIndex.toString()] ?: return
        val userId = _uiState.value.currentUserId
        if (seat.userId != userId) return

        val newMuteState = !seat.isMuted
        // Block unmute without mic permission
        if (!newMuteState && !_uiState.value.hasAudioPermission) {
            _uiState.update { it.copy(error = "Microphone permission required. Please grant it in Settings.") }
            return
        }
        // Block unmute when voice is not connected — muting is always allowed
        if (!newMuteState && voiceService.connectionState.value != VoiceConnectionState.CONNECTED) {
            val msg =
                if (_uiState.value.isVoiceUnavailable) {
                    "Voice is currently unavailable"
                } else {
                    "Voice not connected yet"
                }
            _uiState.update { it.copy(error = msg) }
            return
        }
        val loadingMsg = if (newMuteState) "Muting..." else "Unmuting..."
        val successMsg = if (newMuteState) "Muted" else "Unmuted"

        withSeatAction(loadingMsg, successMsg) {
            val result = roomRepository.toggleMute(roomId, seatIndex, newMuteState)
            if (result is Resource.Success) {
                voiceService.setMicrophoneEnabled(!newMuteState)
                voiceService.setAudioMode(!newMuteState)
            }
            result
        }
    }

    fun forceMuteUser(seatIndex: Int) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole
            if (role == RoomRole.ATTENDEE) return@launch

            val seat = room.seats[seatIndex.toString()] ?: return@launch
            val targetUserId = seat.userId ?: return@launch

            // Cannot force-mute owner; hosts can't force-mute other hosts
            if (targetUserId == room.ownerId) return@launch
            if (role == RoomRole.HOST && targetUserId in room.hostIds) return@launch

            // Only mute, never unmute — only the user themselves can unmute
            if (seat.isMuted) return@launch
            roomRepository.toggleMute(roomId, seatIndex, true)
        }
    }

    fun moveSeat(
        fromIndex: Int,
        toIndex: Int,
    ) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole
            if (role == RoomRole.ATTENDEE) return@launch

            // Cannot move from/to owner seat
            if (fromIndex == Constants.OWNER_SEAT_INDEX || toIndex == Constants.OWNER_SEAT_INDEX) return@launch

            val fromSeat = room.seats[fromIndex.toString()] ?: return@launch
            val targetUserId = fromSeat.userId ?: return@launch

            // Can only move normal users
            val isTargetOwner = targetUserId == room.ownerId
            val isTargetHost = targetUserId in room.hostIds
            if (role == RoomRole.HOST && (isTargetOwner || isTargetHost)) return@launch

            // If destination is occupied, swap the two users
            roomRepository.moveSeat(roomId, fromIndex, toIndex, targetUserId)
        }
    }

    fun kickUser(
        targetUserId: String,
        seatIndex: Int?,
        reason: String = "",
    ) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole
            if (role == RoomRole.ATTENDEE) return@launch

            // Cannot kick owner; hosts can't kick other hosts
            if (targetUserId == room.ownerId) return@launch
            if (role == RoomRole.HOST && targetUserId in room.hostIds) return@launch

            val kickerName = _uiState.value.currentUserName
            val targetUser = userCache[targetUserId]
            val targetName = targetUser?.displayName ?: "A user"
            val displayReason = reason.ifBlank { "No reason given" }

            roomRepository.kickUser(roomId, targetUserId, seatIndex, kickerName, displayReason)
            messageRepository.sendSystemMessage(roomId, "$targetName was kicked")
        }
    }

    fun addHost(userId: String) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            if (_uiState.value.currentUserId != room.ownerId) return@launch
            roomRepository.addHost(roomId, userId)
        }
    }

    fun removeHost(userId: String) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            if (_uiState.value.currentUserId != room.ownerId) return@launch
            roomRepository.removeHost(roomId, userId)
        }
    }

    fun inviteUser(
        userId: String,
        userName: String,
    ) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole

            // Don't invite someone who is already seated or already invited
            if (room.findUserSeat(userId) != null) return@launch
            if (userId in room.pendingInvites) return@launch

            // Check the person is still in the room
            if (userId !in room.participantIds) {
                _uiState.update { it.copy(error = "$userName has left the room") }
                return@launch
            }

            // Owner can always invite; hosts only when requireApproval is OFF
            if (role == RoomRole.ATTENDEE) return@launch
            if (role == RoomRole.HOST && room.requireApproval) return@launch

            roomRepository.sendInvite(roomId, userId, _uiState.value.currentUserId)
        }
    }

    fun inviteFromMessage(
        senderId: String,
        senderName: String,
    ) {
        inviteUser(senderId, senderName)
    }

    fun acceptInvite() {
        if (_uiState.value.seatActionStatus is SeatActionStatus.Loading) return
        dismissCurrentNotification()
        val userId = _uiState.value.currentUserId
        val room = _uiState.value.room ?: return
        if (room.pendingInvites[userId] == null) return

        // Find first empty seat within effective limit (skip owner seat)
        val limit = _uiState.value.effectiveSeatCount
        val emptySeatIndex =
            (1 until limit).firstOrNull { i ->
                val seat = room.seats[i.toString()]
                seat != null && seat.state != SeatState.OCCUPIED
            } ?: return

        withSeatAction("Accepting invite...", "Seated") {
            roomRepository.acceptInvite(roomId, userId, emptySeatIndex)
        }
    }

    fun declineInvite() {
        dismissCurrentNotification()
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            roomRepository.cancelInvite(roomId, userId)
        }
    }

    fun sendMessage(text: String) {
        if (text.isBlank()) return

        val now = currentTimeMillis()

        // Remove timestamps older than the flood window
        while (recentMessageTimestamps.isNotEmpty() &&
            now - recentMessageTimestamps.first() > Constants.FLOOD_WINDOW_MS
        ) {
            recentMessageTimestamps.removeFirst()
        }

        // Enforce minimum cooldown between messages
        val lastSent = recentMessageTimestamps.lastOrNull()
        if (lastSent != null && now - lastSent < Constants.FLOOD_COOLDOWN_MS) {
            _uiState.update { it.copy(error = "Slow down! Wait a moment before sending another message.") }
            return
        }

        // Enforce max messages per window
        if (recentMessageTimestamps.size >= Constants.FLOOD_MAX_MESSAGES) {
            _uiState.update { it.copy(error = "Too many messages. Please wait a few seconds.") }
            return
        }

        recentMessageTimestamps.addLast(now)

        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val userName = _uiState.value.currentUserName
            messageRepository.sendMessage(roomId, userId, userName, text)
        }
    }

    @Suppress("kotlin:S3776")
    fun leaveRoom() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val room = _uiState.value.room ?: return@launch
            logD(TAG, "leaveRoom (VM): userId=$userId isOwner=${room.ownerId == userId}")

            roomLifecycleManager.markLeaveStarted(roomId)
            disconnectFromRoom()

            // Use NonCancellable so Firestore cleanup completes even if ViewModel is destroyed
            withContext(NonCancellable) {
                try {
                    if (room.ownerId == userId) {
                        // Check if anyone else is still on mic
                        val anyoneOnMic =
                            room.seats.any { (_, seat) ->
                                seat.userId != null && seat.userId != userId && seat.state == SeatState.OCCUPIED
                            }
                        if (anyoneOnMic) {
                            // Owner keeps seat 0 — stays visible during OWNER_AWAY
                            logD(TAG, "leaveRoom (VM): owner with others on mic → setOwnerAway")
                            roomRepository.setOwnerAway(roomId)
                        } else {
                            logD(TAG, "leaveRoom (VM): owner alone → closeRoom")
                            roomRepository.closeRoom(roomId)
                        }
                    } else {
                        // Non-owner: clear seat on explicit leave
                        val mySeatEntry = room.findUserSeat(userId)
                        if (mySeatEntry != null) {
                            roomRepository.leaveSeat(roomId, mySeatEntry.key.toInt())
                        }
                    }

                    // Only non-owners leave the participant list;
                    // owner stays in participants during OWNER_AWAY for reconnection
                    if (room.ownerId != userId) {
                        roomRepository.leaveRoom(roomId, userId)

                        // If no non-owner seats remain in an OWNER_AWAY room, close it —
                        // don't count unseated visitors, only seated users matter.
                        if (room.state == RoomState.OWNER_AWAY) {
                            val othersStillSeated =
                                room.seats.any { (_, seat) ->
                                    seat.userId != null &&
                                        seat.userId != userId &&
                                        seat.userId != room.ownerId &&
                                        seat.state == SeatState.OCCUPIED
                                }
                            if (!othersStillSeated) {
                                logD(TAG, "leaveRoom: no seated non-owners left in OWNER_AWAY room → closeRoom")
                                roomRepository.closeRoom(roomId)
                            }
                        }
                    }
                } finally {
                    roomLifecycleManager.markLeaveCompleted(roomId)
                }
            }
        }
    }

    @Suppress("kotlin:S3776")
    fun ownerReturn() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val room = _uiState.value.room ?: return@launch
            if (room.ownerId != userId) return@launch

            // Cancel countdown immediately — don't wait for Firestore round-trip
            ownerAwayCountdownJob?.cancel()
            _uiState.update { it.copy(ownerAwayRemainingMs = 0L) }

            try {
                logD(TAG, "ownerReturn: calling setOwnerReturned")
                roomRepository.setOwnerReturned(roomId, userId)

                // Always re-establish presence — the RTDB onDisconnect may have
                // fired while WiFi was off, removing the owner's presence entry.
                // Without this, other phones keep detecting the owner as absent.
                presenceService.setPresence(roomId, userId)

                // Re-establish room tracking if lost during disconnect
                if (!roomLifecycleManager.isInRoom(roomId)) {
                    roomLifecycleManager.trackRoom(roomId)
                }

                // Rejoin voice if needed — sync to seat's actual mute state
                val voiceRoom = room.voiceRoomName
                if (voiceRoom.isNotEmpty()) {
                    if (!voiceService.isJoined.value) {
                        voiceService.joinRoom(voiceRoom, userId)
                        // Timeout: unblock room if voice doesn't reconnect in time
                        viewModelScope.launch {
                            delay(VOICE_CONNECT_TIMEOUT_MS)
                            if (!_uiState.value.isVoiceReady) {
                                _uiState.update { it.copy(isVoiceReady = true, isVoiceUnavailable = true) }
                            }
                        }
                    }
                    val mySeat = room.findUserSeat(userId)?.value
                    val shouldUnmute = mySeat != null && !mySeat.isMuted && _uiState.value.hasAudioPermission
                    voiceService.setMicrophoneEnabled(shouldUnmute)
                    voiceService.setAudioMode(shouldUnmute)
                }
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                logE(TAG, "ownerReturn failed, will retry on next room update", e)
                isOwnerReturnTriggered = false
            }
        }
    }

    fun updateRoomName(newName: String) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            if (_uiState.value.currentUserId != room.ownerId) return@launch
            roomRepository.updateRoomName(roomId, newName)
        }
    }

    fun closeRoom() {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            if (_uiState.value.currentUserId != room.ownerId) return@launch

            logI(TAG, "Closing room: roomId=$roomId")
            disconnectFromRoom()
            roomRepository.closeRoom(roomId)
            _uiState.update { it.copy(roomClosed = true) }
        }
    }

    private fun loadSeatUsers(room: ChatRoom) {
        val seatedUserIds =
            room.seats.values
                .asSequence()
                .filter { it.state == SeatState.OCCUPIED && it.userId != null }
                .mapNotNull { it.userId }
                .toSet()

        if (seatedUserIds == lastSeatedUserIds && seatedUserIds.all { it in userCache }) return
        lastSeatedUserIds = seatedUserIds

        loadUsersForIds(seatedUserIds) { cached ->
            _uiState.update { it.copy(seatUsers = cached) }
        }
    }

    private fun loadParticipantUsers(room: ChatRoom) {
        if (room.participantIds == lastParticipantIds && room.participantIds.all { it in userCache }) return
        lastParticipantIds = room.participantIds

        loadUsersForIds(room.participantIds) { cached ->
            _uiState.update { it.copy(participantUsers = cached) }
        }
    }

    private fun loadUsersForIds(
        userIds: Set<String>,
        onLoaded: (Map<String, User>) -> Unit,
    ) {
        val newUserIds = userIds.filter { it !in userCache }
        if (newUserIds.isEmpty()) {
            val filtered = userCache.filterKeys { it in userIds }
            onLoaded(filtered)
            accumulateKnownUsers(filtered)
            return
        }

        viewModelScope.launch {
            when (val result = userRepository.getUsers(newUserIds)) {
                is Resource.Success -> {
                    result.data.forEach { user -> userCache[user.uid] = user }
                    // Persist to shared cache so re-entry skips these API calls
                    roomLifecycleManager.updateSharedUserCache(userCache)
                }

                else -> Unit
            }
            val filtered = userCache.filterKeys { it in userIds }
            onLoaded(filtered)
            accumulateKnownUsers(filtered)
        }
    }

    private fun accumulateKnownUsers(newUsers: Map<String, User>) {
        if (newUsers.isEmpty()) return
        val current = _uiState.value.allKnownUsers
        val hasNew = newUsers.any { it.key !in current }
        if (hasNew) {
            _uiState.update { it.copy(allKnownUsers = it.allKnownUsers + newUsers) }
            // Re-resolve room duration/seat limit if the owner was just loaded
            val room = _uiState.value.room
            if (room != null && room.ownerId in newUsers) {
                resolveRoomDuration()
                resolveSeatLimit()
            }
        }
    }

    private fun loadAliases() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            when (val result = userRepository.getAliases(userId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(aliases = result.data) }
                }

                else -> Unit
            }
        }
    }

    private fun loadBlockedUsers() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            when (val result = userRepository.getBlockedUserIds(userId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(blockedUserIds = result.data) }
                }

                else -> Unit
            }
        }
    }

    fun blockUser(targetUserId: String) {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            when (userRepository.blockUser(userId, targetUserId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(blockedUserIds = it.blockedUserIds + targetUserId) }
                }

                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to block user") }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    fun unblockUser(targetUserId: String) {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            when (userRepository.unblockUser(userId, targetUserId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(blockedUserIds = it.blockedUserIds - targetUserId) }
                }

                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to unblock user") }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    private fun buildClosedSummary(closedRoom: ChatRoom?): RoomClosedSummary? {
        // Use closed room data if available, fall back to last known snapshot
        val room = closedRoom ?: lastKnownRoom ?: return null

        val createdMs = room.createdAt
        val closedMs = room.closedAt ?: currentTimeMillis()
        val durationMs = closedMs - createdMs

        // Host users: owner + anyone who was ever a host, owner always first
        val hostIds = room.allTimeHostIds + room.ownerId
        val hostUsers =
            hostIds
                .mapNotNull { userCache[it] }
                .sortedByDescending { it.uid == room.ownerId }

        // Speaker users: anyone who sat on a seat but was never a host and isn't the owner
        val speakerIds = room.allTimeSeatUserIds - hostIds
        val speakerUsers = speakerIds.mapNotNull { userCache[it] }

        // Total unique visitors from firstJoinTimestamps, fall back to lastKnownRoom
        val visitors =
            room.firstJoinTimestamps.size.coerceAtLeast(
                lastKnownRoom?.participantIds?.size ?: 0,
            )

        return RoomClosedSummary(
            roomName = room.name,
            durationMs = durationMs,
            hostUsers = hostUsers,
            speakerUsers = speakerUsers,
            ownerId = room.ownerId,
            totalVisitors = visitors,
        )
    }

    fun startEditMessage(
        messageId: String,
        text: String,
    ) {
        _uiState.update { it.copy(editingMessageId = messageId, editingMessageText = text) }
    }

    fun cancelEditMessage() {
        _uiState.update { it.copy(editingMessageId = null, editingMessageText = "") }
    }

    fun editMessage(newText: String) {
        val messageId = _uiState.value.editingMessageId ?: return
        if (newText.isBlank()) return
        _uiState.update { it.copy(editingMessageId = null, editingMessageText = "") }
        viewModelScope.launch {
            messageRepository.editMessage(roomId, messageId, newText.trim())
        }
    }

    fun setAlias(
        targetUserId: String,
        alias: String,
    ) {
        val userId = _uiState.value.currentUserId
        viewModelScope.launch {
            when (userRepository.setAlias(userId, targetUserId, alias)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(aliases = it.aliases + (targetUserId to alias)) }
                }

                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to set alias") }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    fun removeAlias(targetUserId: String) {
        val userId = _uiState.value.currentUserId
        viewModelScope.launch {
            when (userRepository.removeAlias(userId, targetUserId)) {
                is Resource.Success -> {
                    _uiState.update { it.copy(aliases = it.aliases - targetUserId) }
                }

                is Resource.Error -> {
                    _uiState.update { it.copy(error = "Failed to remove alias") }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun dismissExpiryUpsellDialog() {
        _uiState.update { it.copy(showExpiryUpsellDialog = false) }
    }

    val superShyDurationHours: Int
        get() = (lastEconomyConfig?.superShyRoomDurationMinutes ?: 720) / 60

    fun reportUser(
        targetUserId: String,
        reason: String,
        description: String,
        evidenceImages: List<Pair<ByteArray, String>> = emptyList(),
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSubmittingReport = true, reportError = null) }

            val currentUser =
                userCache[_uiState.value.currentUserId]
                    ?: when (val result = userRepository.getUser(_uiState.value.currentUserId)) {
                        is Resource.Success -> result.data
                        else -> null
                    }
            val targetUser =
                userCache[targetUserId]
                    ?: when (val result = userRepository.getUser(targetUserId)) {
                        is Resource.Success -> result.data
                        else -> null
                    }
            if (currentUser == null || targetUser == null) {
                _uiState.update { it.copy(isSubmittingReport = false, reportError = "Could not submit report") }
                return@launch
            }

            // Upload evidence
            val evidenceUrls = mutableListOf<String>()
            for ((bytes, mimeType) in evidenceImages) {
                when (
                    val result =
                        storageRepository.uploadImage(
                            currentUser.uid,
                            "report_evidence",
                            bytes,
                            mimeType,
                        )
                ) {
                    is Resource.Success -> evidenceUrls.add(result.data)

                    is Resource.Error -> {
                        _uiState.update { it.copy(isSubmittingReport = false, reportError = "Failed to upload evidence") }
                        return@launch
                    }

                    is Resource.Loading -> Unit
                }
            }

            when (
                reportRepository.reportUser(
                    reporterId = currentUser.uid,
                    reporterName = currentUser.displayName,
                    reporterUniqueId = currentUser.uniqueId,
                    reportedUserId = targetUser.uid,
                    reportedUserName = targetUser.displayName,
                    reportedUserUniqueId = targetUser.uniqueId,
                    conversationId = "",
                    reason = reason,
                    description = description,
                    evidenceUrls = evidenceUrls,
                )
            ) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isSubmittingReport = false, reportSubmitted = true) }
                }

                is Resource.Error -> {
                    _uiState.update { it.copy(isSubmittingReport = false, reportError = "Failed to submit report") }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    fun clearReportSubmitted() {
        _uiState.update { it.copy(reportSubmitted = false, reportError = null) }
    }

    // --- Notification Queue ---

    private fun enqueueNotification(notification: RoomNotification) {
        when (notification) {
            is RoomNotification.SeatRequestReceived ->
                if (notification.request.requestId in processedRequestIds) return

            is RoomNotification.RequestApproved -> {
                if (notification.request.requestId in processedApprovalIds) return
                // Approved request supersedes any pending invite — remove it from queue
                notificationQueue.removeAll { it is RoomNotification.InviteReceived }
            }

            is RoomNotification.InviteReceived -> {
                // Suppress invite if a RequestApproved is already active or queued
                // (the approved-request dialog already tells the user they can sit)
                val approvedActive = _uiState.value.activeNotification is RoomNotification.RequestApproved
                val approvedQueued = notificationQueue.any { it is RoomNotification.RequestApproved }
                if (approvedActive || approvedQueued) return
            }
        }
        if (notificationQueue.any { it.id == notification.id }) return
        if (_uiState.value.activeNotification?.id == notification.id) return

        if (_uiState.value.activeNotification == null) {
            showNotification(notification)
        } else {
            notificationQueue.add(notification)
        }
    }

    private fun showNotification(notification: RoomNotification) {
        _uiState.update { it.copy(activeNotification = notification) }
        if (notification is RoomNotification.SeatRequestReceived) {
            autoDismissJob?.cancel()
            autoDismissJob =
                viewModelScope.launch {
                    delay(Constants.SEAT_REQUEST_AUTO_DISMISS_MS)
                    dismissCurrentNotification()
                }
        }
    }

    fun dismissCurrentNotification() {
        val current = _uiState.value.activeNotification
        if (current != null) {
            when (current) {
                is RoomNotification.SeatRequestReceived ->
                    processedRequestIds.add(current.request.requestId)

                is RoomNotification.RequestApproved ->
                    processedApprovalIds.add(current.request.requestId)

                is RoomNotification.InviteReceived -> Unit
            }
        }
        autoDismissJob?.cancel()
        _uiState.update { it.copy(activeNotification = null) }
        if (notificationQueue.isNotEmpty()) {
            showNotification(notificationQueue.removeFirst())
        }
    }

    // --- Observe Seat Requests ---

    /** Re-filter raw requests against latest room state and enqueue new notifications. */
    private fun refilterPendingRequests() {
        val room = _uiState.value.room
        val validRequests =
            rawPendingRequests.filter { req ->
                val alreadySeated = room?.findUserSeat(req.userId) != null
                val leftRoom = room != null && req.userId !in room.participantIds
                val locallyApproved = req.requestId in locallyApprovedRequestIds
                !alreadySeated && !leftRoom && !locallyApproved
            }
        val current = _uiState.value.pendingRequestsForPanel
        if (validRequests.map { it.requestId } == current.map { it.requestId }) return
        _uiState.update { it.copy(pendingRequestsForPanel = validRequests) }

        val role = _uiState.value.currentRole
        val isHostOrOwner = role == RoomRole.OWNER || role == RoomRole.HOST
        if (isHostOrOwner && _uiState.value.hasJoined) {
            for (request in validRequests) {
                if (request.requestId !in processedRequestIds) {
                    enqueueNotification(RoomNotification.SeatRequestReceived(request))
                }
            }
        }
    }

    private fun observePendingRequests() {
        viewModelScope.launch {
            seatRequestRepository
                .getPendingRequests(roomId)
                .catch { e -> logW(TAG, "observePendingRequests error", e) }
                .collect { requests ->
                    rawPendingRequests = requests
                    refilterPendingRequests()
                }
        }
    }

    private var areInitialApprovalsSuppressed = false

    private fun observeMyRequest() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            seatRequestRepository
                .getRequestsByUser(roomId, userId)
                .catch { e -> logW(TAG, "observeMyRequest error", e) }
                .collect { requests ->
                    // On the first emission, suppress all existing approved requests.
                    // Only approvals that arrive in later emissions (freshly approved
                    // during this session) will trigger notifications.
                    if (!areInitialApprovalsSuppressed) {
                        areInitialApprovalsSuppressed = true
                        requests
                            .filter { it.status == SeatRequestStatus.APPROVED }
                            .forEach { processedApprovalIds.add(it.requestId) }
                        return@collect
                    }

                    val approvedRequest =
                        requests.firstOrNull {
                            it.status == SeatRequestStatus.APPROVED
                        } ?: return@collect

                    if (approvedRequest.requestId in processedApprovalIds) return@collect

                    val alreadySeated = _uiState.value.room?.findUserSeat(userId) != null
                    if (alreadySeated) return@collect

                    // During the grace period the owner auto-seats the requester,
                    // so suppress the "request accepted" dialog — user is being seated immediately.
                    val requestAge = currentTimeMillis() - approvedRequest.createdAt
                    if (requestAge <= Constants.SEAT_REQUEST_IMMEDIATE_THRESHOLD_MS) {
                        processedApprovalIds.add(approvedRequest.requestId)
                        return@collect
                    }

                    enqueueNotification(RoomNotification.RequestApproved(approvedRequest))
                }
        }
    }

    // --- Notification Actions ---

    fun approveRequestFromNotification(request: SeatRequest) {
        viewModelScope.launch {
            val createdAtMs = request.createdAt
            val nowMs = currentTimeMillis()
            val delayMs = nowMs - createdAtMs

            // Immediately exclude this request from the pending list to avoid flicker
            locallyApprovedRequestIds.add(request.requestId)
            refilterPendingRequests()

            when (
                val result =
                    seatRequestRepository.approveRequest(
                        roomId,
                        request.requestId,
                        _uiState.value.currentUserId,
                    )
            ) {
                is Resource.Success -> {
                    val approved = result.data
                    if (delayMs <= Constants.SEAT_REQUEST_IMMEDIATE_THRESHOLD_MS) {
                        roomRepository.takeSeat(roomId, approved.seatIndex, approved.userId)
                    }
                    dismissCurrentNotification()
                }

                is Resource.Error -> {
                    _uiState.update { it.copy(error = result.message) }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    fun denyRequestFromNotification(request: SeatRequest) {
        viewModelScope.launch {
            seatRequestRepository.denyRequest(roomId, request.requestId, _uiState.value.currentUserId)
            dismissCurrentNotification()
        }
    }

    fun acceptApprovedRequest(request: SeatRequest) {
        if (_uiState.value.seatActionStatus is SeatActionStatus.Loading) return
        val room = _uiState.value.room ?: return
        val userId = _uiState.value.currentUserId

        // Already seated — just dismiss, don't re-seat
        if (room.findUserSeat(userId) != null) {
            dismissCurrentNotification()
            return
        }

        val limit = _uiState.value.effectiveSeatCount
        val seat = room.seats[request.seatIndex.toString()]
        val seatIndex: Int =
            if (seat?.state == SeatState.OCCUPIED || request.seatIndex >= limit) {
                // Original seat taken or beyond limit, find next available within limit
                val available =
                    (1 until limit).firstOrNull { i ->
                        val s = room.seats[i.toString()]
                        s != null && s.state != SeatState.OCCUPIED
                    }
                if (available == null) {
                    dismissCurrentNotification()
                    _uiState.update { it.copy(error = "No seats available") }
                    return
                }
                available
            } else {
                request.seatIndex
            }
        dismissCurrentNotification()
        withSeatAction("Taking seat...", "Seated") {
            roomRepository.takeSeat(roomId, seatIndex, userId)
        }
    }

    fun declineApprovedRequest(request: SeatRequest) {
        viewModelScope.launch {
            seatRequestRepository.cancelApprovedRequest(roomId, request.requestId, _uiState.value.currentUserId)
            dismissCurrentNotification()
        }
    }

    fun onAudioPermissionResult(granted: Boolean) {
        logD(TAG, "onAudioPermissionResult granted=$granted isSeated=$isSeated")
        _uiState.update { it.copy(hasAudioPermission = granted) }
        // Do NOT enable mic here. User must explicitly unmute via toggleSelfMute (Bug #6).
    }

    fun setRoomScreenVisible(visible: Boolean) {
        roomLifecycleManager.setRoomScreenVisible(visible)
    }

    private fun autoTranslateNewMessages(messages: List<Message>) {
        if (!LanguagePreference.getAutoTranslate()) return
        val repo = translationRepository ?: return
        val uid = _uiState.value.currentUserId
        val targetLang = LanguagePreference.get()
        val toTranslate =
            messages.filter { msg ->
                msg.senderId != uid &&
                    msg.senderId != "system" &&
                    msg.type == com.shyden.shytalk.core.model.MessageType.TEXT &&
                    msg.text.isNotBlank() &&
                    msg.messageId !in autoTranslatedMessageIds &&
                    !_uiState.value.translations.containsKey(msg.messageId)
            }
        for (msg in toTranslate) {
            autoTranslatedMessageIds.add(msg.messageId)
            viewModelScope.launch {
                when (val result = repo.translate(msg.text, targetLang, "rooms/$roomId/messages/${msg.messageId}")) {
                    is Resource.Success ->
                        _uiState.update {
                            it.copy(translations = it.translations + (msg.messageId to result.data.translatedText))
                        }

                    else -> { /* ignore errors for auto-translate */ }
                }
            }
        }
    }

    fun translateMessage(messageId: String) {
        val repo = translationRepository ?: return
        val message = _uiState.value.messages.find { it.messageId == messageId } ?: return
        if (_uiState.value.translations.containsKey(messageId)) return
        val targetLang =
            com.shyden.shytalk.core.util.LanguagePreference
                .get()
        viewModelScope.launch {
            when (val result = repo.translate(message.text, targetLang, "rooms/$roomId/messages/$messageId")) {
                is Resource.Success ->
                    _uiState.update {
                        it.copy(translations = it.translations + (messageId to result.data.translatedText))
                    }

                else -> { /* Loading or Error */ }
            }
        }
    }

    override fun onCleared() {
        super.onCleared()
        ownerAwayCountdownJob?.cancel()
        roomExpiryCountdownJob?.cancel()
        seatActionResetJob?.cancel()
        userObserverJob?.cancel()
        userCache.clear()
        // DO NOT call presenceService.removePresence() or voiceService.leaveChannel()
        // Voice/presence survive ViewModel destruction; explicit leaveRoom() handles cleanup.
    }
}
