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
import com.shyden.shytalk.data.remote.AgoraVoiceService
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.UserRepository
import dagger.hilt.android.qualifiers.ApplicationContext
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
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class ActiveRoomManager @Inject constructor(
    private val roomRepository: RoomRepository,
    private val messageRepository: MessageRepository,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val seatRequestRepository: SeatRequestRepository,
    val agoraVoiceService: AgoraVoiceService,
    private val presenceService: PresenceService,
    @param:ApplicationContext private val context: Context
) {
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
    private var connectionMonitorJob: Job? = null
    private var presenceMonitorJob: Job? = null
    private var isSeated = false

    var currentUserName: String = ""
        private set

    val currentUserId: String
        get() = authRepository.currentUser?.uid ?: ""

    fun isInRoom(roomId: String): Boolean = _activeRoomId.value == roomId
    fun isInAnyRoom(): Boolean = _activeRoomId.value != null

    /** Called by RoomViewModel after joining a room. Starts foreground service. */
    fun trackRoom(roomId: String) {
        _activeRoomId.value = roomId
        _roomClosed.value = false
        RoomService.start(context, roomId)
        startConnectionMonitor()
        startPresenceMonitor()
    }

    /** Called by RoomViewModel on each room update. Keeps notification current. */
    fun updateTrackedRoom(room: ChatRoom) {
        _activeRoom.value = room
    }

    /** Called by RoomViewModel when user explicitly leaves. Stops service. */
    fun untrackRoom() {
        _activeRoomId.value = null
        _activeRoom.value = null
        _messages.value = emptyList()
        _ownerAwayRemainingMs.value = 0L
        _roomClosed.value = false
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
        val roomId = _activeRoomId.value ?: return
        val room = _activeRoom.value ?: return
        val userId = currentUserId

        presenceService.removePresence()

        // Vacate seats
        room.seats.forEach { (index, seat) ->
            if (seat.userId == userId) {
                if (index.toInt() == Constants.OWNER_SEAT_INDEX && room.ownerId == userId) {
                    roomRepository.leaveSeat(roomId, index.toInt())
                    roomRepository.setOwnerAway(roomId)
                } else {
                    roomRepository.leaveSeat(roomId, index.toInt())
                }
            }
        }

        agoraVoiceService.leaveChannel()

        // Non-owners leave the participant list
        if (room.ownerId != userId) {
            roomRepository.leaveRoom(roomId, userId)
        }

        messageRepository.sendSystemMessage(
            roomId,
            "${currentUserName.ifEmpty { "Someone" }} left the room"
        )

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
                        agoraVoiceService.leaveChannel()
                        _roomClosed.value = true
                        cleanup()
                        return@collect
                    }

                    val userId = currentUserId

                    // Detect if user was kicked
                    if (userId !in room.participantIds || userId in room.bannedUserIds) {
                        agoraVoiceService.leaveChannel()
                        _roomClosed.value = true
                        cleanup()
                        return@collect
                    }

                    // Switch Agora role based on seat status
                    val currentlySeated = room.seats.values.any {
                        it.userId == userId && it.state == SeatState.OCCUPIED
                    }
                    if (currentlySeated && !isSeated) {
                        agoraVoiceService.setRole(true)
                    } else if (!currentlySeated && isSeated) {
                        agoraVoiceService.setRole(false)
                    }
                    isSeated = currentlySeated

                    // Sync mute state
                    if (currentlySeated) {
                        val mySeat = room.seats.values.find { it.userId == userId }
                        mySeat?.let { agoraVoiceService.muteLocalAudio(it.isMuted) }
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

            agoraVoiceService.connectionState.collect { state ->
                val room = _activeRoom.value ?: return@collect
                val userId = currentUserId

                // Only monitor when user is seated (has an Agora connection)
                val currentlySeated = room.seats.values.any {
                    it.userId == userId && it.state == SeatState.OCCUPIED
                }
                if (!currentlySeated) {
                    graceJob?.cancel()
                    wasEverConnected = false
                    return@collect
                }

                when (state) {
                    AgoraVoiceService.ConnectionState.CONNECTED -> {
                        wasEverConnected = true
                        graceJob?.cancel()
                    }
                    AgoraVoiceService.ConnectionState.DISCONNECTED -> {
                        if (!wasEverConnected) return@collect

                        graceJob?.cancel()
                        graceJob = scope.launch {
                            delay(Constants.AGORA_DISCONNECT_GRACE_PERIOD_MS)
                            if (_activeRoomId.value != null) {
                                leaveRoom()
                            }
                        }
                    }
                    AgoraVoiceService.ConnectionState.RECONNECTING -> {
                        // Wait — Agora is trying to reconnect
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

            presenceService.observeRoomPresence(roomId)
                .catch { e -> Log.w("ActiveRoomManager", "Presence monitor error", e) }
                .collect { presentUserIds ->
                    val room = _activeRoom.value ?: return@collect
                    val participantIds = room.participantIds.toSet()

                    // Users in room but not present in RTDB
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
                        }
                    }
                }
        }
    }

    private fun handleOwnerAwayCountdown(room: ChatRoom) {
        if (room.state == RoomState.OWNER_AWAY && room.ownerLeftAt != null) {
            ownerAwayCountdownJob?.cancel()
            ownerAwayCountdownJob = scope.launch {
                while (true) {
                    val elapsed = System.currentTimeMillis() - room.ownerLeftAt.toDate().time
                    val remaining = Constants.OWNER_LEAVE_TIMEOUT_MS - elapsed
                    if (remaining <= 0) {
                        if (resolveRole(room, currentUserId) == RoomRole.OWNER) {
                            roomRepository.closeRoom(room.roomId)
                        }
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

    fun resolveRole(room: ChatRoom?, userId: String): RoomRole {
        if (room == null) return RoomRole.ATTENDEE
        return when {
            room.ownerId == userId -> RoomRole.OWNER
            userId in room.hostIds -> RoomRole.HOST
            else -> RoomRole.ATTENDEE
        }
    }

    suspend fun takeSeat(seatIndex: Int) {
        val roomId = _activeRoomId.value ?: return
        val room = _activeRoom.value ?: return
        val userId = currentUserId
        val role = resolveRole(room, userId)

        if (role == RoomRole.OWNER && seatIndex != Constants.OWNER_SEAT_INDEX) return
        if (seatIndex == Constants.OWNER_SEAT_INDEX && role != RoomRole.OWNER) return

        val seat = room.seats[seatIndex.toString()] ?: return
        if (seat.state == SeatState.OCCUPIED) return

        if (role == RoomRole.ATTENDEE) {
            seatRequestRepository.createRequest(roomId, userId, currentUserName, seatIndex)
            return
        }
        if (role == RoomRole.HOST && room.requireApproval) return

        val currentSeatEntry = room.seats.entries.find {
            it.value.userId == userId && it.value.state == SeatState.OCCUPIED
        }
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
        val role = resolveRole(room, currentUserId)
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
        roomRepository.toggleMute(roomId, seatIndex, newMuteState)
        agoraVoiceService.muteLocalAudio(newMuteState)
    }

    suspend fun forceMuteUser(seatIndex: Int) {
        val roomId = _activeRoomId.value ?: return
        val room = _activeRoom.value ?: return
        val role = resolveRole(room, currentUserId)
        if (role == RoomRole.ATTENDEE) return

        val seat = room.seats[seatIndex.toString()] ?: return
        val targetUserId = seat.userId ?: return
        if (targetUserId == room.ownerId || targetUserId in room.hostIds) return

        roomRepository.toggleMute(roomId, seatIndex, !seat.isMuted)
    }

    suspend fun moveSeat(fromIndex: Int, toIndex: Int) {
        val roomId = _activeRoomId.value ?: return
        val room = _activeRoom.value ?: return
        val role = resolveRole(room, currentUserId)
        if (role == RoomRole.ATTENDEE) return
        if (fromIndex == Constants.OWNER_SEAT_INDEX || toIndex == Constants.OWNER_SEAT_INDEX) return

        val fromSeat = room.seats[fromIndex.toString()] ?: return
        val targetUserId = fromSeat.userId ?: return
        if (role == RoomRole.HOST && (targetUserId == room.ownerId || targetUserId in room.hostIds)) return

        val toSeat = room.seats[toIndex.toString()] ?: return
        if (toSeat.state == SeatState.OCCUPIED) return

        roomRepository.moveSeat(roomId, fromIndex, toIndex, targetUserId)
    }

    suspend fun kickUser(seatIndex: Int) {
        val roomId = _activeRoomId.value ?: return
        val room = _activeRoom.value ?: return
        val role = resolveRole(room, currentUserId)
        if (role == RoomRole.ATTENDEE) return

        val seat = room.seats[seatIndex.toString()] ?: return
        val targetUserId = seat.userId ?: return
        if (targetUserId == room.ownerId || targetUserId in room.hostIds) return

        roomRepository.kickUser(roomId, targetUserId, seatIndex)
        messageRepository.sendSystemMessage(roomId, "A user was kicked from the room")
    }

    suspend fun inviteUser(userId: String, userName: String) {
        val roomId = _activeRoomId.value ?: return
        val room = _activeRoom.value ?: return
        val role = resolveRole(room, currentUserId)
        if (role == RoomRole.ATTENDEE) return
        if (role == RoomRole.HOST && room.requireApproval) return

        roomRepository.sendInvite(roomId, userId, currentUserId)
        messageRepository.sendSystemMessage(roomId, "${userName.ifEmpty { "Someone" }} was invited to sit")
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
        roomRepository.setOwnerReturned(roomId, currentUserId)
    }

    suspend fun closeRoom() {
        val roomId = _activeRoomId.value ?: return
        agoraVoiceService.leaveChannel()
        roomRepository.closeRoom(roomId)
        messageRepository.sendSystemMessage(roomId, "Room has been closed")
        _roomClosed.value = true
        cleanup()
    }

    fun clearError() {
        _error.value = null
    }
}
