package com.shyden.shytalk.core.room

import android.content.Context
import android.util.Log
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.VoiceConnectionState
import com.shyden.shytalk.data.remote.VoiceService
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch

class ActiveRoomManager(
    private val roomRepository: RoomRepository,
    private val messageRepository: MessageRepository,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val seatRequestRepository: SeatRequestRepository,
    val voiceService: VoiceService,
    private val presenceService: PresenceService,
    private val context: Context
) : RoomLifecycleManager {
    companion object {
        private const val TAG = "ActiveRoomManager"
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private val _activeRoomId = MutableStateFlow<String?>(null)
    val activeRoomId: StateFlow<String?> = _activeRoomId.asStateFlow()

    private val _activeRoom = MutableStateFlow<ChatRoom?>(null)
    val activeRoom: StateFlow<ChatRoom?> = _activeRoom.asStateFlow()

    private val _messages = MutableStateFlow<List<Message>>(emptyList())
    val messages: StateFlow<List<Message>> = _messages.asStateFlow()

    private val _ownerAwayRemainingMs = MutableStateFlow(0L)
    val ownerAwayRemainingMs: StateFlow<Long> = _ownerAwayRemainingMs.asStateFlow()

    private val _roomClosed = MutableStateFlow(false)
    val roomClosed: StateFlow<Boolean> = _roomClosed.asStateFlow()

    private val _error = MutableStateFlow<String?>(null)
    val error: StateFlow<String?> = _error.asStateFlow()

    private var roomObserverJob: Job? = null
    private var messageObserverJob: Job? = null
    private var ownerAwayCountdownJob: Job? = null
    private val _isRoomScreenVisible = MutableStateFlow(false)
    val isRoomScreenVisible: StateFlow<Boolean> = _isRoomScreenVisible.asStateFlow()

    private val _disconnectedUserIds = MutableStateFlow<Set<String>>(emptySet())
    override val disconnectedUserIds: StateFlow<Set<String>> = _disconnectedUserIds.asStateFlow()

    private var connectionMonitorJob: Job? = null
    private var presenceMonitorJob: Job? = null
    private var isSeated = false

    private val leaveSignals = mutableMapOf<String, CompletableDeferred<Unit>>()

    override fun markLeaveStarted(roomId: String) {
        leaveSignals[roomId] = CompletableDeferred()
    }

    override fun markLeaveCompleted(roomId: String) {
        leaveSignals.remove(roomId)?.complete(Unit)
    }

    override suspend fun awaitLeaveCompletion(roomId: String) {
        leaveSignals[roomId]?.await()
    }

    var isAppInForeground: Boolean = false

    var currentUserName: String = ""
        private set

    val currentUserId: String
        get() = authRepository.currentUserId ?: ""

    override fun isInRoom(roomId: String): Boolean = _activeRoomId.value == roomId
    fun isInAnyRoom(): Boolean = _activeRoomId.value != null

    override fun setRoomScreenVisible(visible: Boolean) {
        _isRoomScreenVisible.value = visible
    }

    /** Called by RoomViewModel after joining a room. Starts foreground service. */
    override fun trackRoom(roomId: String) {
        _activeRoomId.value = roomId
        _roomClosed.value = false
        RoomService.start(context, roomId)
        startConnectionMonitor()
        startPresenceMonitor()
    }

    /** Called by RoomViewModel on each room update. Keeps notification current. */
    override fun updateTrackedRoom(room: ChatRoom) {
        _activeRoom.value = room
    }

    /** Called by RoomViewModel when user explicitly leaves. Stops service. */
    override fun untrackRoom() {
        connectionMonitorJob?.cancel()
        presenceMonitorJob?.cancel()
        ownerAwayCountdownJob?.cancel()
        isSeated = false
        _activeRoomId.value = null
        _activeRoom.value = null
        _messages.value = emptyList()
        _ownerAwayRemainingMs.value = 0L
        _roomClosed.value = false
        _disconnectedUserIds.value = emptySet()
        RoomService.stop(context)
    }

    suspend fun enterRoom(roomId: String) {
        if (_activeRoomId.value == roomId) return

        _activeRoomId.value = roomId
        _roomClosed.value = false
        _error.value = null
        isSeated = false

        loadUserName()
        startRoomObservation(roomId)
        startMessageObservation(roomId)
        startConnectionMonitor()

        roomRepository.joinRoom(roomId, currentUserId)
        messageRepository.sendSystemMessage(
            roomId,
            "${currentUserName.ifEmpty { "Someone" }} joined the room"
        )

        RoomService.start(context, roomId)
    }

    suspend fun leaveRoom() {
        val roomId = _activeRoomId.value ?: run {
            Log.d(TAG, "leaveRoom: no activeRoomId, returning")
            return
        }
        val room = _activeRoom.value ?: run {
            Log.d(TAG, "leaveRoom: no activeRoom, returning")
            return
        }
        val userId = currentUserId
        val isOwner = room.ownerId == userId
        Log.d(TAG, "leaveRoom: roomId=$roomId userId=$userId isOwner=$isOwner")

        presenceService.removePresence()

        // Vacate seat — owner keeps seat 0 for reconnection
        val mySeatEntry = room.findUserSeat(userId)
        if (isOwner) {
            val anyoneOnMic = room.seats.any { (_, seat) ->
                seat.userId != null && seat.userId != userId && seat.state == SeatState.OCCUPIED
            }
            if (anyoneOnMic) {
                Log.d(TAG, "leaveRoom: owner → setOwnerAway (others present, seat preserved)")
                roomRepository.setOwnerAway(roomId)
            } else {
                Log.d(TAG, "leaveRoom: owner alone → closeRoom")
                roomRepository.closeRoom(roomId)
            }
        } else if (mySeatEntry != null) {
            Log.d(TAG, "leaveRoom: non-owner → leaveSeat(${mySeatEntry.key})")
            roomRepository.leaveSeat(roomId, mySeatEntry.key.toInt())
        }

        voiceService.leaveChannel()

        // Non-owners leave the participant list
        if (!isOwner) {
            roomRepository.leaveRoom(roomId, userId)
        }

        cleanup()
    }

    suspend fun ensureSingleRoom() {
        // Leave current room if in one
        if (_activeRoomId.value != null) {
            leaveRoom()
        }

        // Close any active rooms owned by this user
        val ownedRoomId = roomRepository.findActiveRoomByOwner(currentUserId)
        if (ownedRoomId != null) {
            roomRepository.closeRoom(ownedRoomId)
        }
    }

    private fun findMySeat(room: ChatRoom, userId: String = currentUserId) =
        room.findUserSeat(userId)?.value

    private fun isUserSeated(room: ChatRoom, userId: String = currentUserId) =
        room.findUserSeat(userId) != null

    private fun cleanup() {
        roomObserverJob?.cancel()
        messageObserverJob?.cancel()
        ownerAwayCountdownJob?.cancel()
        connectionMonitorJob?.cancel()
        presenceMonitorJob?.cancel()
        isSeated = false
        _activeRoomId.value = null
        _activeRoom.value = null
        _messages.value = emptyList()
        _ownerAwayRemainingMs.value = 0L
        _roomClosed.value = false
        _disconnectedUserIds.value = emptySet()

        RoomService.stop(context)
    }

    private suspend fun loadUserName() {
        when (val result = userRepository.getUser(currentUserId)) {
            is Resource.Success -> currentUserName = result.data.displayName
            else -> {}
        }
    }

    // --- Room Observation ---

    private fun startRoomObservation(roomId: String) {
        roomObserverJob?.cancel()
        roomObserverJob = scope.launch {
            roomRepository.getRoomFlow(roomId)
                .catch { e -> _error.value = e.message }
                .collect { room ->
                    if (room == null || room.state == RoomState.CLOSED) {
                        voiceService.leaveChannel()
                        _roomClosed.value = true
                        cleanup()
                        return@collect
                    }

                    val userId = currentUserId

                    // Detect if user was kicked
                    if (userId !in room.participantIds || userId in room.bannedUserIds) {
                        voiceService.leaveChannel()
                        _roomClosed.value = true
                        cleanup()
                        return@collect
                    }

                    // Switch mic based on seat status (single lookup)
                    val mySeat = findMySeat(room, userId)
                    val currentlySeated = mySeat != null
                    if (currentlySeated != isSeated && !currentlySeated) {
                        voiceService.setMicrophoneEnabled(false)
                        voiceService.setAudioMode(false)
                    }
                    // When becoming seated: do NOT enable mic. User starts muted (Bug #6).
                    isSeated = currentlySeated

                    if (mySeat != null) {
                        // Sync mute state and audio mode
                        val shouldUnmute = !mySeat.isMuted
                        voiceService.setMicrophoneEnabled(shouldUnmute)
                        voiceService.setAudioMode(shouldUnmute)

                        // Ensure connected to voice room
                        if (!voiceService.isJoined.value && room.voiceRoomName.isNotEmpty()) {
                            voiceService.joinRoom(room.voiceRoomName, currentUserId)
                            voiceService.setMicrophoneEnabled(shouldUnmute)
                            voiceService.setAudioMode(shouldUnmute)
                        }
                    }

                    _activeRoom.value = room
                    handleOwnerAwayCountdown(room)
                }
        }
    }

    private fun startMessageObservation(roomId: String) {
        messageObserverJob?.cancel()
        messageObserverJob = scope.launch {
            messageRepository.getMessages(roomId)
                .catch { /* ignore */ }
                .collect { messages -> _messages.value = messages }
        }
    }

    private fun startConnectionMonitor() {
        connectionMonitorJob?.cancel()
        connectionMonitorJob = scope.launch {
            var graceJob: Job? = null
            var wasEverConnected = false

            voiceService.connectionState.collect { state ->
                val room = _activeRoom.value ?: return@collect
                val userId = currentUserId
                val currentlySeated = room.findUserSeat(userId) != null
                Log.d(TAG, "connectionMonitor: state=$state userId=$userId ownerId=${room.ownerId} seated=$currentlySeated wasEver=$wasEverConnected")

                // Only monitor when user is seated (has a voice connection)
                if (!currentlySeated) {
                    graceJob?.cancel()
                    wasEverConnected = false
                    return@collect
                }

                when (state) {
                    VoiceConnectionState.CONNECTED -> {
                        wasEverConnected = true
                        graceJob?.cancel()
                    }
                    VoiceConnectionState.DISCONNECTED -> {
                        if (!wasEverConnected) return@collect

                        // Owner must NOT leave from their own device on network loss.
                        val isOwner = room.ownerId == userId
                        if (isOwner) {
                            Log.d(TAG, "connectionMonitor: owner disconnected — skipping leaveRoom, presence system will handle")
                            return@collect
                        }

                        graceJob?.cancel()
                        graceJob = scope.launch {
                            delay(Constants.VOICE_DISCONNECT_GRACE_PERIOD_MS)
                            val currentRoom = _activeRoom.value ?: return@launch
                            val seatEntry = currentRoom.findUserSeat(currentUserId)
                            if (seatEntry != null && _activeRoomId.value != null) {
                                Log.d(TAG, "connectionMonitor: non-owner voice disconnect timeout — removing from seat ${seatEntry.key}")
                                roomRepository.leaveSeat(_activeRoomId.value!!, seatEntry.key.toInt())
                            }
                        }
                    }
                    VoiceConnectionState.RECONNECTING -> {
                        // Wait — LiveKit is trying to reconnect
                    }
                }
            }
        }
    }

    private fun startPresenceMonitor() {
        val roomId = _activeRoomId.value ?: return
        presenceMonitorJob?.cancel()
        presenceMonitorJob = scope.launch {
            val graceTimers = mutableMapOf<String, Job>()

            fun emitDisconnectedIds() {
                val newSet = graceTimers.keys.toSet()
                if (newSet != _disconnectedUserIds.value) {
                    _disconnectedUserIds.value = newSet
                }
            }

            presenceService.observeRoomPresence(roomId)
                .catch { e -> Log.w(TAG, "Presence monitor error", e) }
                .collect { presentUserIds ->
                    val room = _activeRoom.value ?: return@collect
                    val participantIds = room.participantIds

                    // Users in room but not present in RTDB (include seated users for dimming)
                    val absentUsers = participantIds - presentUserIds - currentUserId

                    // Cancel timers for users who reappeared
                    val reappeared = graceTimers.keys - absentUsers
                    for (userId in reappeared) {
                        graceTimers.remove(userId)?.cancel()
                    }

                    // Start grace timers for newly absent users
                    for (userId in absentUsers) {
                        if (userId in graceTimers) continue
                        graceTimers[userId] = scope.launch {
                            delay(Constants.PRESENCE_TIMEOUT_MS)
                            roomRepository.removeDisconnectedUser(roomId, userId)
                            graceTimers.remove(userId)
                            emitDisconnectedIds()
                        }
                    }

                    emitDisconnectedIds()
                }
        }
    }

    private fun handleOwnerAwayCountdown(room: ChatRoom) {
        val leftAt = room.ownerLeftAt
        if (room.state == RoomState.OWNER_AWAY && leftAt != null) {
            ownerAwayCountdownJob?.cancel()
            ownerAwayCountdownJob = scope.launch {
                while (true) {
                    val elapsed = System.currentTimeMillis() - leftAt
                    val remaining = Constants.OWNER_LEAVE_TIMEOUT_MS - elapsed
                    if (remaining <= 0) {
                        // Any remaining participant can close an expired OWNER_AWAY room
                        roomRepository.closeRoom(room.roomId)
                        break
                    }
                    _ownerAwayRemainingMs.value = remaining
                    delay(1000L)
                }
            }
        } else {
            ownerAwayCountdownJob?.cancel()
            _ownerAwayRemainingMs.value = 0L
        }
    }

    // --- Room Actions ---

    suspend fun takeSeat(seatIndex: Int) {
        val roomId = _activeRoomId.value ?: return
        val room = _activeRoom.value ?: return
        val userId = currentUserId
        val role = room.resolveRole(userId)

        if (role == RoomRole.OWNER && seatIndex != Constants.OWNER_SEAT_INDEX) return
        if (seatIndex == Constants.OWNER_SEAT_INDEX && role != RoomRole.OWNER) return

        val seat = room.seats[seatIndex.toString()] ?: return
        if (seat.state == SeatState.OCCUPIED) return

        if (role == RoomRole.ATTENDEE) {
            seatRequestRepository.createRequest(roomId, userId, currentUserName, seatIndex)
            return
        }
        if (role == RoomRole.HOST && room.requireApproval) return

        val currentSeatEntry = room.findUserSeat(userId)
        if (currentSeatEntry != null) {
            roomRepository.leaveSeat(roomId, currentSeatEntry.key.toInt())
        }
        roomRepository.takeSeat(roomId, seatIndex, userId)
    }

    suspend fun leaveSeat(seatIndex: Int) {
        val roomId = _activeRoomId.value ?: return
        val room = _activeRoom.value ?: return
        if (seatIndex == Constants.OWNER_SEAT_INDEX && room.ownerId == currentUserId) return
        roomRepository.leaveSeat(roomId, seatIndex)
    }

    suspend fun removeFromSeat(seatIndex: Int) {
        val roomId = _activeRoomId.value ?: return
        val room = _activeRoom.value ?: return
        val role = room.resolveRole(currentUserId)
        if (role == RoomRole.ATTENDEE) return
        if (seatIndex == Constants.OWNER_SEAT_INDEX) return

        val seat = room.seats[seatIndex.toString()] ?: return
        val targetUserId = seat.userId ?: return
        if (role == RoomRole.HOST && (targetUserId == room.ownerId || targetUserId in room.hostIds)) return

        roomRepository.removeFromSeat(roomId, seatIndex)
    }

    suspend fun toggleSelfMute(seatIndex: Int) {
        val roomId = _activeRoomId.value ?: return
        val room = _activeRoom.value ?: return
        val seat = room.seats[seatIndex.toString()] ?: return
        if (seat.userId != currentUserId) return

        val newMuteState = !seat.isMuted
        // Block unmute when voice is not connected — muting is always allowed
        if (!newMuteState && voiceService.connectionState.value != VoiceConnectionState.CONNECTED) {
            _error.value = "Voice not connected yet"
            return
        }

        roomRepository.toggleMute(roomId, seatIndex, newMuteState)
        voiceService.setMicrophoneEnabled(!newMuteState)
    }

    suspend fun forceMuteUser(seatIndex: Int) {
        val roomId = _activeRoomId.value ?: return
        val room = _activeRoom.value ?: return
        val role = room.resolveRole(currentUserId)
        if (role == RoomRole.ATTENDEE) return

        val seat = room.seats[seatIndex.toString()] ?: return
        val targetUserId = seat.userId ?: return
        if (targetUserId == room.ownerId) return
        if (role == RoomRole.HOST && targetUserId in room.hostIds) return

        // Only mute, never unmute — only the user themselves can unmute
        if (seat.isMuted) return
        roomRepository.toggleMute(roomId, seatIndex, true)
    }

    suspend fun moveSeat(fromIndex: Int, toIndex: Int) {
        val roomId = _activeRoomId.value ?: return
        val room = _activeRoom.value ?: return
        val role = room.resolveRole(currentUserId)
        if (role == RoomRole.ATTENDEE) return
        if (fromIndex == Constants.OWNER_SEAT_INDEX || toIndex == Constants.OWNER_SEAT_INDEX) return

        val fromSeat = room.seats[fromIndex.toString()] ?: return
        val targetUserId = fromSeat.userId ?: return
        if (role == RoomRole.HOST && (targetUserId == room.ownerId || targetUserId in room.hostIds)) return

        // Destination can be empty or occupied (swap)
        roomRepository.moveSeat(roomId, fromIndex, toIndex, targetUserId)
    }

    suspend fun kickUser(targetUserId: String, seatIndex: Int?, reason: String = "") {
        val roomId = _activeRoomId.value ?: return
        val room = _activeRoom.value ?: return
        val role = room.resolveRole(currentUserId)
        if (role == RoomRole.ATTENDEE) return

        if (targetUserId == room.ownerId) return
        if (role == RoomRole.HOST && targetUserId in room.hostIds) return

        val displayReason = reason.ifBlank { "No reason given" }
        roomRepository.kickUser(roomId, targetUserId, seatIndex, kickerName = "", reason = displayReason)
        messageRepository.sendSystemMessage(roomId, "A user was kicked from the room. Reason: $displayReason")
    }

    suspend fun inviteUser(userId: String, userName: String) {
        val roomId = _activeRoomId.value ?: return
        val room = _activeRoom.value ?: return
        val role = room.resolveRole(currentUserId)
        if (role == RoomRole.ATTENDEE) return
        if (role == RoomRole.HOST && room.requireApproval) return

        roomRepository.sendInvite(roomId, userId, currentUserId)
    }

    suspend fun acceptInvite() {
        val roomId = _activeRoomId.value ?: return
        val room = _activeRoom.value ?: return
        if (room.pendingInvites[currentUserId] == null) return

        val emptySeatIndex = (1 until Constants.MAX_SEATS).firstOrNull { i ->
            val seat = room.seats[i.toString()]
            seat != null && seat.state != SeatState.OCCUPIED
        } ?: return

        roomRepository.acceptInvite(roomId, currentUserId, emptySeatIndex)
    }

    suspend fun declineInvite() {
        val roomId = _activeRoomId.value ?: return
        roomRepository.cancelInvite(roomId, currentUserId)
    }

    suspend fun sendMessage(text: String) {
        if (text.isBlank()) return
        val roomId = _activeRoomId.value ?: return
        messageRepository.sendMessage(roomId, currentUserId, currentUserName, text)
    }

    suspend fun ownerReturn() {
        val roomId = _activeRoomId.value ?: return
        val room = _activeRoom.value ?: return
        if (room.ownerId != currentUserId) return
        // Cancel countdown immediately — don't wait for Firestore round-trip
        ownerAwayCountdownJob?.cancel()
        _ownerAwayRemainingMs.value = 0L
        roomRepository.setOwnerReturned(roomId, currentUserId)
    }

    suspend fun closeRoom() {
        val roomId = _activeRoomId.value ?: return
        voiceService.leaveChannel()
        roomRepository.closeRoom(roomId)
        _roomClosed.value = true
        cleanup()
    }

    fun clearError() {
        _error.value = null
    }
}
