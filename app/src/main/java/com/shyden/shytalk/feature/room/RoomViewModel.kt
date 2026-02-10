package com.shyden.shytalk.feature.room

import androidx.lifecycle.SavedStateHandle
import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.MessageType
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.room.ActiveRoomManager
import com.shyden.shytalk.data.remote.AgoraVoiceService
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.google.firebase.Timestamp
import dagger.hilt.android.lifecycle.HiltViewModel
import kotlinx.coroutines.Job
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import android.util.Log
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class BlockWarning {
    data object BlockedByRoomOwner : BlockWarning()
    data object BlockedUserInRoom : BlockWarning()
    data object BlockedByUserInRoom : BlockWarning()
}

data class RoomClosedSummary(
    val roomName: String,
    val durationMs: Long,
    val hostUsers: List<User>,
    val totalVisitors: Int
)

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
    val speakingUids: Set<Int> = emptySet(),
    val isVoiceJoined: Boolean = false,
    val pendingInvite: String? = null,
    val seatUsers: Map<String, User> = emptyMap(),
    val participantUsers: Map<String, User> = emptyMap(),
    val blockedUserIds: Set<String> = emptySet(),
    val blockWarning: BlockWarning? = null,
    val hasJoined: Boolean = false,
    val shouldNavigateBack: Boolean = false,
    val wasKicked: Boolean = false,
    val hasAudioPermission: Boolean = false
)

@HiltViewModel
class RoomViewModel @Inject constructor(
    savedStateHandle: SavedStateHandle,
    private val roomRepository: RoomRepository,
    private val messageRepository: MessageRepository,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val seatRequestRepository: SeatRequestRepository,
    private val agoraVoiceService: AgoraVoiceService,
    private val presenceService: PresenceService,
    private val activeRoomManager: ActiveRoomManager
) : ViewModel() {

    companion object {
        private const val TAG = "RoomViewModel"
    }

    private val roomId: String = savedStateHandle["roomId"] ?: ""

    private val _uiState = MutableStateFlow(RoomUiState())
    val uiState: StateFlow<RoomUiState> = _uiState.asStateFlow()

    private var ownerAwayCountdownJob: Job? = null
    private var isSeated = false
    private val userCache = mutableMapOf<String, User>()
    private var blockCheckDone = false
    private var firstJoinTimestamp: Timestamp? = null
    private var allMessages: List<Message> = emptyList()
    private var lastKnownRoom: ChatRoom? = null
    private var ownerReturnTriggered = false
    private var lastSeatedUserIds: Set<String> = emptySet()
    private var lastParticipantIds: List<String> = emptyList()

    init {
        val userId = authRepository.currentUser?.uid ?: ""
        _uiState.value = _uiState.value.copy(currentUserId = userId)
        loadUserName()
        loadBlockedUsers()
        observeRoom()
        observeMessages()
        observeVoiceState()
    }

    private fun loadUserName() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            when (val result = userRepository.getUser(userId)) {
                is Resource.Success -> {
                    _uiState.value = _uiState.value.copy(
                        currentUserName = result.data.displayName
                    )
                }
                else -> {}
            }
        }
    }

    private fun observeRoom() {
        viewModelScope.launch {
            roomRepository.getRoomFlow(roomId)
                .catch { e ->
                    _uiState.value = _uiState.value.copy(
                        isLoading = false,
                        error = e.message
                    )
                }
                .collect { room ->
                    if (room == null || room.state == RoomState.CLOSED) {
                        handleRoomClosed(room)
                        return@collect
                    }

                    lastKnownRoom = room
                    val userId = _uiState.value.currentUserId

                    if (_uiState.value.hasJoined && handleKickedOrRemoved(room, userId)) {
                        return@collect
                    }

                    val role = resolveRole(room, userId)

                    if (!blockCheckDone && !_uiState.value.hasJoined) {
                        handleFirstJoin(room, userId, role)
                        return@collect
                    }

                    handleOwnerReturnDetection(room, userId)
                    handleNormalUpdate(room, userId, role)
                }
        }
    }

    private fun handleRoomClosed(room: ChatRoom?) {
        agoraVoiceService.leaveChannel()
        presenceService.removePresence()
        activeRoomManager.untrackRoom()
        val summary = buildClosedSummary(room)
        _uiState.value = _uiState.value.copy(
            isLoading = false,
            roomClosed = true,
            roomClosedSummary = summary
        )
    }

    /** Returns true if user was kicked/removed and collection should stop. */
    private fun handleKickedOrRemoved(room: ChatRoom, userId: String): Boolean {
        if (userId in room.bannedUserIds) {
            agoraVoiceService.leaveChannel()
            presenceService.removePresence()
            activeRoomManager.untrackRoom()
            _uiState.value = _uiState.value.copy(isLoading = false, wasKicked = true)
            return true
        }
        if (userId !in room.participantIds) {
            agoraVoiceService.leaveChannel()
            presenceService.removePresence()
            activeRoomManager.untrackRoom()
            _uiState.value = _uiState.value.copy(isLoading = false, shouldNavigateBack = true)
            return true
        }
        return false
    }

    private fun handleFirstJoin(room: ChatRoom, userId: String, role: RoomRole) {
        blockCheckDone = true

        // Detect "already joined" state (ViewModel recreated after back navigation)
        val alreadyInRoom = userId in room.participantIds && activeRoomManager.isInRoom(roomId)
        if (alreadyInRoom) {
            _uiState.value = _uiState.value.copy(
                room = room, currentRole = role, isLoading = false, hasJoined = true
            )
            // Track seat state so handleNormalUpdate detects transitions correctly
            isSeated = room.seats.values.any {
                it.userId == userId && it.state == SeatState.OCCUPIED
            }
            // Rejoin voice if not already connected (ViewModel recreated)
            if (room.agoraChannelName.isNotEmpty()) {
                val asBroadcaster = isSeated && _uiState.value.hasAudioPermission
                viewModelScope.launch {
                    val uid = userId.hashCode() and 0x7FFFFFFF
                    agoraVoiceService.joinChannel(room.agoraChannelName, uid, asBroadcaster = asBroadcaster)
                }
            }
            activeRoomManager.updateTrackedRoom(room)
            loadSeatUsers(room)
            loadParticipantUsers(room)
            handleOwnerAwayCountdown(room)
            return
        }

        _uiState.value = _uiState.value.copy(
            room = room, currentRole = role, isLoading = false
        )
        if (room.ownerId == userId) {
            joinRoom()
        } else {
            checkBlockConflicts(room)
        }
        loadSeatUsers(room)
        loadParticipantUsers(room)
        handleOwnerAwayCountdown(room)
    }

    private fun handleOwnerReturnDetection(room: ChatRoom, userId: String) {
        if (room.state == RoomState.OWNER_AWAY
            && room.ownerId == userId
            && _uiState.value.hasJoined
            && !ownerReturnTriggered
        ) {
            ownerReturnTriggered = true
            ownerReturn()
        }
        if (room.state == RoomState.ACTIVE) {
            ownerReturnTriggered = false
        }
    }

    private fun handleNormalUpdate(room: ChatRoom, userId: String, role: RoomRole) {
        val currentlySeated = room.seats.values.any {
            it.userId == userId && it.state == SeatState.OCCUPIED
        }

        if (currentlySeated && !isSeated) {
            Log.d(TAG, "User became seated, hasAudioPermission=${_uiState.value.hasAudioPermission}")
            if (_uiState.value.hasAudioPermission) {
                agoraVoiceService.setRole(true)
            }
        } else if (!currentlySeated && isSeated) {
            Log.d(TAG, "User left seat, switching to audience")
            agoraVoiceService.setRole(false)
        }
        isSeated = currentlySeated

        if (currentlySeated) {
            val mySeat = room.seats.values.find { it.userId == userId }
            mySeat?.let { agoraVoiceService.muteLocalAudio(it.isMuted) }
        }

        val pendingInvite = room.pendingInvites[userId]

        val joinTs = room.firstJoinTimestamps[userId]
        if (joinTs != null && firstJoinTimestamp == null) {
            firstJoinTimestamp = joinTs
            updateFilteredMessages()
        }

        _uiState.value = _uiState.value.copy(
            room = room,
            currentRole = role,
            isLoading = false,
            pendingInvite = pendingInvite
        )

        activeRoomManager.updateTrackedRoom(room)
        loadSeatUsers(room)
        loadParticipantUsers(room)
        handleOwnerAwayCountdown(room)
    }

    private fun checkBlockConflicts(room: ChatRoom) {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val myBlockedIds = _uiState.value.blockedUserIds

            // Check if user is banned from this room (kicked previously)
            if (userId in room.bannedUserIds) {
                _uiState.value = _uiState.value.copy(
                    blockWarning = BlockWarning.BlockedByRoomOwner
                )
                return@launch
            }

            // Always check room owner's block list (even if owner is away)
            val ownerUser = userCache[room.ownerId] ?: when (val result = userRepository.getUser(room.ownerId)) {
                is Resource.Success -> {
                    userCache[room.ownerId] = result.data
                    result.data
                }
                else -> null
            }
            if (ownerUser != null && userId in ownerUser.blockedUserIds) {
                _uiState.value = _uiState.value.copy(
                    blockWarning = BlockWarning.BlockedByRoomOwner
                )
                return@launch
            }

            // Check if any participant is blocked by me
            val blockedInRoom = room.participantIds.any { it in myBlockedIds && it != userId }
            if (blockedInRoom) {
                _uiState.value = _uiState.value.copy(
                    blockWarning = BlockWarning.BlockedUserInRoom
                )
                return@launch
            }

            // Check if any other participant (non-owner) has blocked me
            val otherParticipantIds = room.participantIds.filter { it != userId && it != room.ownerId }
            val uncachedIds = otherParticipantIds.filter { it !in userCache }
            if (uncachedIds.isNotEmpty()) {
                coroutineScope {
                    uncachedIds.map { pid ->
                        async {
                            when (val result = userRepository.getUser(pid)) {
                                is Resource.Success -> pid to result.data
                                else -> null
                            }
                        }
                    }.awaitAll().filterNotNull().forEach { (id, user) ->
                        userCache[id] = user
                    }
                }
            }
            for (participantId in otherParticipantIds) {
                val participantUser = userCache[participantId] ?: continue
                if (userId in participantUser.blockedUserIds) {
                    _uiState.value = _uiState.value.copy(
                        blockWarning = BlockWarning.BlockedByUserInRoom
                    )
                    return@launch
                }
            }

            // No conflicts, join directly
            joinRoom()
        }
    }

    fun confirmJoinDespiteBlock() {
        _uiState.value = _uiState.value.copy(blockWarning = null)
        joinRoom()
    }

    fun cancelJoin() {
        _uiState.value = _uiState.value.copy(shouldNavigateBack = true)
    }

    private fun observeMessages() {
        viewModelScope.launch {
            messageRepository.getMessages(roomId)
                .catch { /* ignore message errors */ }
                .collect { messages ->
                    allMessages = messages
                    updateFilteredMessages()
                }
        }
    }

    private fun updateFilteredMessages() {
        val ts = firstJoinTimestamp
        val filtered = if (ts != null) {
            allMessages.filter { it.createdAt >= ts && it.type != MessageType.SYSTEM }
        } else {
            allMessages.filter { it.type != MessageType.SYSTEM }
        }
        _uiState.value = _uiState.value.copy(messages = filtered)
    }

    private fun observeVoiceState() {
        viewModelScope.launch {
            agoraVoiceService.speakingUsers.collect { speaking ->
                _uiState.value = _uiState.value.copy(speakingUids = speaking)
            }
        }
        viewModelScope.launch {
            agoraVoiceService.isJoined.collect { joined ->
                _uiState.value = _uiState.value.copy(isVoiceJoined = joined)
            }
        }
        viewModelScope.launch {
            agoraVoiceService.error.collect { errorMsg ->
                if (errorMsg != null) {
                    _uiState.value = _uiState.value.copy(error = errorMsg)
                    agoraVoiceService.clearError()
                }
            }
        }
    }

    private fun joinRoom() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val room = _uiState.value.room

            // Already in this room (e.g., returned after pressing back)
            if (room != null && userId in room.participantIds && activeRoomManager.isInRoom(roomId)) {
                _uiState.value = _uiState.value.copy(hasJoined = true)
                activeRoomManager.trackRoom(roomId)
                return@launch
            }

            // Ensure user name is loaded before sending join message
            if (_uiState.value.currentUserName.isEmpty()) {
                when (val result = userRepository.getUser(userId)) {
                    is Resource.Success -> {
                        _uiState.value = _uiState.value.copy(
                            currentUserName = result.data.displayName
                        )
                    }
                    else -> {}
                }
            }
            val userName = _uiState.value.currentUserName
            roomRepository.leaveAllRooms(userId, exceptRoomId = roomId)
            roomRepository.recordFirstJoinTimestamp(roomId, userId)
            roomRepository.joinRoom(roomId, userId)
            presenceService.setPresence(roomId, userId)
            _uiState.value = _uiState.value.copy(hasJoined = true)

            // Start foreground service via ActiveRoomManager
            activeRoomManager.trackRoom(roomId)

            // Join voice channel — as broadcaster if already seated with permission, otherwise audience
            val channel = room?.agoraChannelName
            if (!channel.isNullOrEmpty()) {
                val uid = userId.hashCode() and 0x7FFFFFFF
                val alreadySeated = room.seats.values.any {
                    it.userId == userId && it.state == SeatState.OCCUPIED
                }
                val asBroadcaster = alreadySeated && _uiState.value.hasAudioPermission
                if (alreadySeated) isSeated = true
                agoraVoiceService.joinChannel(channel, uid, asBroadcaster = asBroadcaster)
            }

            if (userName.isNotEmpty()) {
                messageRepository.sendJoinMessage(
                    roomId,
                    userId,
                    userName,
                    "$userName joined the room"
                )
            }
        }
    }

    private fun joinVoiceChannelAsAudience(channelName: String) {
        viewModelScope.launch {
            val uid = _uiState.value.currentUserId.hashCode() and 0x7FFFFFFF
            Log.d(TAG, "joinVoiceChannelAsAudience channel=$channelName uid=$uid")
            agoraVoiceService.joinChannel(channelName, uid, asBroadcaster = false)
        }
    }

    private fun resolveRole(room: ChatRoom, userId: String): RoomRole {
        return when {
            room.ownerId == userId -> RoomRole.OWNER
            userId in room.hostIds -> RoomRole.HOST
            else -> RoomRole.ATTENDEE
        }
    }

    private fun handleOwnerAwayCountdown(room: ChatRoom) {
        if (room.state == RoomState.OWNER_AWAY && room.ownerLeftAt != null) {
            ownerAwayCountdownJob?.cancel()
            ownerAwayCountdownJob = viewModelScope.launch {
                while (true) {
                    val elapsed = System.currentTimeMillis() - room.ownerLeftAt.toDate().time
                    val remaining = Constants.OWNER_LEAVE_TIMEOUT_MS - elapsed
                    if (remaining <= 0) {
                        if (_uiState.value.currentRole == RoomRole.OWNER) {
                            roomRepository.closeRoom(roomId)
                        }
                        break
                    }
                    _uiState.value = _uiState.value.copy(ownerAwayRemainingMs = remaining)
                    delay(1000L)
                }
            }
        } else {
            ownerAwayCountdownJob?.cancel()
            _uiState.value = _uiState.value.copy(ownerAwayRemainingMs = 0L)
        }
    }

    fun takeSeat(seatIndex: Int) {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole

            // Owner is locked to seat 0
            if (role == RoomRole.OWNER && seatIndex != Constants.OWNER_SEAT_INDEX) return@launch
            // Non-owners cannot take the owner seat
            if (seatIndex == Constants.OWNER_SEAT_INDEX && role != RoomRole.OWNER) return@launch

            val seat = room.seats[seatIndex.toString()] ?: return@launch
            if (seat.state == SeatState.OCCUPIED) return@launch

            // Attendees ALWAYS need approval
            if (role == RoomRole.ATTENDEE) {
                seatRequestRepository.createRequest(
                    roomId = roomId,
                    userId = userId,
                    userName = _uiState.value.currentUserName,
                    seatIndex = seatIndex
                )
                return@launch
            }

            // Hosts can only self-seat when requireApproval is OFF
            if (role == RoomRole.HOST && room.requireApproval) return@launch

            roomRepository.takeSeat(roomId, seatIndex, userId)
        }
    }

    fun leaveSeat(seatIndex: Int) {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val room = _uiState.value.room ?: return@launch

            // Owner cannot leave seat 1
            if (seatIndex == Constants.OWNER_SEAT_INDEX && room.ownerId == userId) return@launch

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
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val seat = room.seats[seatIndex.toString()] ?: return@launch
            val userId = _uiState.value.currentUserId
            if (seat.userId != userId) return@launch

            val newMuteState = !seat.isMuted
            roomRepository.toggleMute(roomId, seatIndex, newMuteState)
            agoraVoiceService.muteLocalAudio(newMuteState)
        }
    }

    fun forceMuteUser(seatIndex: Int) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole
            if (role == RoomRole.ATTENDEE) return@launch

            val seat = room.seats[seatIndex.toString()] ?: return@launch
            val targetUserId = seat.userId ?: return@launch

            // Can only force-mute normal users (attendees)
            val isTargetOwner = targetUserId == room.ownerId
            val isTargetHost = targetUserId in room.hostIds
            if (isTargetOwner || isTargetHost) return@launch

            roomRepository.toggleMute(roomId, seatIndex, !seat.isMuted)
        }
    }

    fun moveSeat(fromIndex: Int, toIndex: Int) {
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

            // Destination must be empty
            val toSeat = room.seats[toIndex.toString()] ?: return@launch
            if (toSeat.state == SeatState.OCCUPIED) return@launch

            roomRepository.moveSeat(roomId, fromIndex, toIndex, targetUserId)
        }
    }

    fun kickUser(seatIndex: Int) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole
            if (role == RoomRole.ATTENDEE) return@launch

            val seat = room.seats[seatIndex.toString()] ?: return@launch
            val targetUserId = seat.userId ?: return@launch

            // Cannot kick owner or hosts (hosts can't kick hosts either)
            val isTargetOwner = targetUserId == room.ownerId
            val isTargetHost = targetUserId in room.hostIds
            if (isTargetOwner || isTargetHost) return@launch

            val kickerName = _uiState.value.currentUserName
            val targetUser = userCache[targetUserId]
            val targetName = targetUser?.displayName ?: "A user"

            roomRepository.kickUser(roomId, targetUserId, seatIndex)
            messageRepository.sendSystemMessage(
                roomId,
                "$targetName was kicked by $kickerName"
            )
        }
    }

    fun inviteUser(userId: String, userName: String) {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            val role = _uiState.value.currentRole

            // Don't invite someone who is already seated
            val alreadySeated = room.seats.values.any {
                it.userId == userId && it.state == SeatState.OCCUPIED
            }
            if (alreadySeated) return@launch

            // Owner can always invite; hosts only when requireApproval is OFF
            if (role == RoomRole.ATTENDEE) return@launch
            if (role == RoomRole.HOST && room.requireApproval) return@launch

            roomRepository.sendInvite(roomId, userId, _uiState.value.currentUserId)
            if (userName.isNotEmpty()) {
                messageRepository.sendSystemMessage(
                    roomId,
                    "$userName was invited to sit"
                )
            }
        }
    }

    fun inviteFromMessage(senderId: String, senderName: String) {
        val room = _uiState.value.room ?: return
        // Check the user isn't already seated
        val alreadySeated = room.seats.values.any {
            it.userId == senderId && it.state == SeatState.OCCUPIED
        }
        if (alreadySeated) return
        inviteUser(senderId, senderName)
    }

    fun acceptInvite() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val room = _uiState.value.room ?: return@launch
            if (room.pendingInvites[userId] == null) return@launch

            // Find first empty seat (skip owner seat)
            val emptySeatIndex = (1 until Constants.MAX_SEATS).firstOrNull { i ->
                val seat = room.seats[i.toString()]
                seat != null && seat.state != SeatState.OCCUPIED
            } ?: return@launch

            roomRepository.acceptInvite(roomId, userId, emptySeatIndex)
        }
    }

    fun declineInvite() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            roomRepository.cancelInvite(roomId, userId)
        }
    }

    fun sendMessage(text: String) {
        if (text.isBlank()) return
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val userName = _uiState.value.currentUserName
            messageRepository.sendMessage(roomId, userId, userName, text)
        }
    }

    fun leaveRoom() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val room = _uiState.value.room ?: return@launch

            presenceService.removePresence()
            agoraVoiceService.leaveChannel()
            activeRoomManager.untrackRoom()

            // Use NonCancellable so Firestore cleanup completes even if ViewModel is destroyed
            withContext(NonCancellable) {
                room.seats.forEach { (index, seat) ->
                    if (seat.userId == userId) {
                        roomRepository.leaveSeat(roomId, index.toInt())
                    }
                }

                if (room.ownerId == userId) {
                    // Check if anyone else is still on mic
                    val anyoneOnMic = room.seats.any { (_, seat) ->
                        seat.userId != null && seat.userId != userId && seat.state == SeatState.OCCUPIED
                    }
                    if (anyoneOnMic) {
                        roomRepository.setOwnerAway(roomId)
                    } else {
                        roomRepository.closeRoom(roomId)
                    }
                }

                roomRepository.leaveRoom(roomId, userId)
            }
        }
    }

    fun ownerReturn() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val room = _uiState.value.room ?: return@launch
            if (room.ownerId != userId) return@launch

            roomRepository.setOwnerReturned(roomId, userId)
        }
    }

    fun closeRoom() {
        viewModelScope.launch {
            val room = _uiState.value.room ?: return@launch
            if (_uiState.value.currentUserId != room.ownerId) return@launch

            presenceService.removePresence()
            agoraVoiceService.leaveChannel()
            activeRoomManager.untrackRoom()
            roomRepository.closeRoom(roomId)
            messageRepository.sendSystemMessage(roomId, "Room has been closed")
            _uiState.value = _uiState.value.copy(roomClosed = true)
        }
    }

    private fun loadSeatUsers(room: ChatRoom) {
        val seatedUserIds = room.seats.values
            .filter { it.state == SeatState.OCCUPIED && it.userId != null }
            .mapNotNull { it.userId }
            .toSet()

        // Skip if seated users haven't changed and all are cached
        if (seatedUserIds == lastSeatedUserIds && seatedUserIds.all { it in userCache }) return
        lastSeatedUserIds = seatedUserIds

        val newUserIds = seatedUserIds.filter { it !in userCache }
        if (newUserIds.isEmpty()) {
            _uiState.value = _uiState.value.copy(
                seatUsers = userCache.filterKeys { it in seatedUserIds }
            )
            return
        }

        viewModelScope.launch {
            coroutineScope {
                newUserIds.map { uid ->
                    async {
                        when (val result = userRepository.getUser(uid)) {
                            is Resource.Success -> uid to result.data
                            else -> null
                        }
                    }
                }.awaitAll().filterNotNull().forEach { (id, user) ->
                    userCache[id] = user
                }
            }
            _uiState.value = _uiState.value.copy(
                seatUsers = userCache.filterKeys { it in seatedUserIds }
            )
        }
    }

    private fun loadParticipantUsers(room: ChatRoom) {
        val allParticipantIds = room.participantIds

        // Skip if participants haven't changed and all are cached
        if (allParticipantIds == lastParticipantIds && allParticipantIds.all { it in userCache }) return
        lastParticipantIds = allParticipantIds

        val newUserIds = allParticipantIds.filter { it !in userCache }
        if (newUserIds.isEmpty()) {
            _uiState.value = _uiState.value.copy(
                participantUsers = userCache.filterKeys { it in allParticipantIds }
            )
            return
        }

        viewModelScope.launch {
            coroutineScope {
                newUserIds.map { uid ->
                    async {
                        when (val result = userRepository.getUser(uid)) {
                            is Resource.Success -> uid to result.data
                            else -> null
                        }
                    }
                }.awaitAll().filterNotNull().forEach { (id, user) ->
                    userCache[id] = user
                }
            }
            _uiState.value = _uiState.value.copy(
                participantUsers = userCache.filterKeys { it in allParticipantIds }
            )
        }
    }

    private fun loadBlockedUsers() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            when (val result = userRepository.getBlockedUserIds(userId)) {
                is Resource.Success -> {
                    _uiState.value = _uiState.value.copy(
                        blockedUserIds = result.data.toSet()
                    )
                }
                else -> {}
            }
        }
    }

    fun blockUser(targetUserId: String) {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            when (userRepository.blockUser(userId, targetUserId)) {
                is Resource.Success -> {
                    _uiState.value = _uiState.value.copy(
                        blockedUserIds = _uiState.value.blockedUserIds + targetUserId
                    )
                }
                is Resource.Error -> {
                    _uiState.value = _uiState.value.copy(error = "Failed to block user")
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun unblockUser(targetUserId: String) {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            when (userRepository.unblockUser(userId, targetUserId)) {
                is Resource.Success -> {
                    _uiState.value = _uiState.value.copy(
                        blockedUserIds = _uiState.value.blockedUserIds - targetUserId
                    )
                }
                is Resource.Error -> {
                    _uiState.value = _uiState.value.copy(error = "Failed to unblock user")
                }
                is Resource.Loading -> {}
            }
        }
    }

    private fun buildClosedSummary(closedRoom: ChatRoom?): RoomClosedSummary? {
        // Use closed room data if available, fall back to last known snapshot
        val room = closedRoom ?: lastKnownRoom ?: return null

        val createdMs = room.createdAt.toDate().time
        val closedMs = room.closedAt?.toDate()?.time ?: System.currentTimeMillis()
        val durationMs = closedMs - createdMs

        // Host users: owner + anyone in hostIds
        val hostIds = (listOf(room.ownerId) + room.hostIds).distinct()
        val hostUsers = hostIds.mapNotNull { userCache[it] }

        // Total unique visitors from firstJoinTimestamps, fall back to lastKnownRoom
        val visitors = room.firstJoinTimestamps.size.coerceAtLeast(
            lastKnownRoom?.participantIds?.size ?: 0
        )

        return RoomClosedSummary(
            roomName = room.name,
            durationMs = durationMs,
            hostUsers = hostUsers,
            totalVisitors = visitors
        )
    }

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    fun onAudioPermissionResult(granted: Boolean) {
        Log.d(TAG, "onAudioPermissionResult granted=$granted isSeated=$isSeated")
        _uiState.value = _uiState.value.copy(hasAudioPermission = granted)
        if (granted && isSeated) {
            agoraVoiceService.setRole(true)
        }
    }

    override fun onCleared() {
        super.onCleared()
        ownerAwayCountdownJob?.cancel()
        // DO NOT call presenceService.removePresence() or agoraVoiceService.leaveChannel()
        // Voice/presence survive ViewModel destruction; explicit leaveRoom() handles cleanup.
    }
}
