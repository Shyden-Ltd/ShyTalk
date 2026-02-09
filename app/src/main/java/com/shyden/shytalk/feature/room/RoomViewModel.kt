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
import kotlinx.coroutines.delay
import kotlinx.coroutines.withContext
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import javax.inject.Inject

sealed class BlockWarning {
    data object BlockedUserInRoom : BlockWarning()
    data object BlockedByUserInRoom : BlockWarning()
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
    private val presenceService: PresenceService
) : ViewModel() {

    private val roomId: String = savedStateHandle["roomId"] ?: ""

    private val _uiState = MutableStateFlow(RoomUiState())
    val uiState: StateFlow<RoomUiState> = _uiState.asStateFlow()

    private var ownerAwayCountdownJob: Job? = null
    private var isSeated = false
    private val userCache = mutableMapOf<String, User>()
    private var blockCheckDone = false
    private var firstJoinTimestamp: Timestamp? = null
    private var allMessages: List<Message> = emptyList()

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
                        agoraVoiceService.leaveChannel()
                        _uiState.value = _uiState.value.copy(
                            isLoading = false,
                            roomClosed = true
                        )
                        return@collect
                    }

                    val userId = _uiState.value.currentUserId

                    // Only check kicked status after we've joined
                    if (_uiState.value.hasJoined) {
                        if (userId !in room.participantIds || userId in room.bannedUserIds) {
                            agoraVoiceService.leaveChannel()
                            _uiState.value = _uiState.value.copy(
                                isLoading = false,
                                roomClosed = true
                            )
                            return@collect
                        }
                    }

                    val role = resolveRole(room, userId)

                    // Pre-entry block check (only once, before joining)
                    if (!blockCheckDone && !_uiState.value.hasJoined) {
                        blockCheckDone = true
                        if (room.ownerId == userId) {
                            // Owner skips block checks, joins immediately
                            _uiState.value = _uiState.value.copy(
                                room = room,
                                currentRole = role,
                                isLoading = false
                            )
                            joinRoom()
                        } else {
                            _uiState.value = _uiState.value.copy(
                                room = room,
                                currentRole = role,
                                isLoading = false
                            )
                            checkBlockConflicts(room)
                        }
                        loadSeatUsers(room)
                        loadParticipantUsers(room)
                        handleOwnerAwayCountdown(room)
                        return@collect
                    }

                    // Normal room updates after joining
                    val currentlySeated = room.seats.values.any {
                        it.userId == userId && it.state == SeatState.OCCUPIED
                    }

                    if (currentlySeated && !isSeated) {
                        if (_uiState.value.hasAudioPermission) {
                            joinVoiceChannel(room.agoraChannelName)
                        }
                    } else if (!currentlySeated && isSeated) {
                        agoraVoiceService.leaveChannel()
                    }
                    isSeated = currentlySeated

                    if (currentlySeated) {
                        val mySeat = room.seats.values.find { it.userId == userId }
                        mySeat?.let { agoraVoiceService.muteLocalAudio(it.isMuted) }
                    }

                    val pendingInvite = room.pendingInvites[userId]

                    // Update firstJoinTimestamp from room data
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

                    loadSeatUsers(room)
                    loadParticipantUsers(room)
                    handleOwnerAwayCountdown(room)
                }
        }
    }

    private fun checkBlockConflicts(room: ChatRoom) {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
            val myBlockedIds = _uiState.value.blockedUserIds

            // Check if any participant is blocked by me
            val blockedInRoom = room.participantIds.any { it in myBlockedIds && it != userId }
            if (blockedInRoom) {
                _uiState.value = _uiState.value.copy(
                    blockWarning = BlockWarning.BlockedUserInRoom
                )
                return@launch
            }

            // Check if any participant has blocked me
            for (participantId in room.participantIds) {
                if (participantId == userId) continue
                val cached = userCache[participantId]
                val participantUser = if (cached != null) {
                    cached
                } else {
                    when (val result = userRepository.getUser(participantId)) {
                        is Resource.Success -> {
                            userCache[participantId] = result.data
                            result.data
                        }
                        else -> continue
                    }
                }
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
    }

    private fun joinRoom() {
        viewModelScope.launch {
            val userId = _uiState.value.currentUserId
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
            agoraVoiceService.leaveChannel()
            roomRepository.leaveAllRooms(userId, exceptRoomId = roomId)
            roomRepository.recordFirstJoinTimestamp(roomId, userId)
            roomRepository.joinRoom(roomId, userId)
            presenceService.setPresence(roomId, userId)
            _uiState.value = _uiState.value.copy(hasJoined = true)
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

    private fun joinVoiceChannel(channelName: String) {
        viewModelScope.launch {
            val uid = _uiState.value.currentUserId.hashCode() and 0x7FFFFFFF
            agoraVoiceService.joinChannel(channelName, uid)
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

            roomRepository.kickUser(roomId, targetUserId, seatIndex)
            messageRepository.sendSystemMessage(roomId, "A user was kicked from the room")
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

            // Use NonCancellable so Firestore cleanup completes even if ViewModel is destroyed
            withContext(NonCancellable) {
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
            roomRepository.closeRoom(roomId)
            messageRepository.sendSystemMessage(roomId, "Room has been closed")
            _uiState.value = _uiState.value.copy(roomClosed = true)
        }
    }

    private fun loadSeatUsers(room: ChatRoom) {
        val seatedUserIds = room.seats.values
            .filter { it.state == SeatState.OCCUPIED && it.userId != null }
            .mapNotNull { it.userId }
            .distinct()

        val newUserIds = seatedUserIds.filter { it !in userCache }
        if (newUserIds.isEmpty()) {
            _uiState.value = _uiState.value.copy(
                seatUsers = userCache.filterKeys { it in seatedUserIds }
            )
            return
        }

        viewModelScope.launch {
            for (uid in newUserIds) {
                when (val result = userRepository.getUser(uid)) {
                    is Resource.Success -> userCache[uid] = result.data
                    else -> {}
                }
            }
            _uiState.value = _uiState.value.copy(
                seatUsers = userCache.filterKeys { it in seatedUserIds }
            )
        }
    }

    private fun loadParticipantUsers(room: ChatRoom) {
        val allParticipantIds = room.participantIds

        val newUserIds = allParticipantIds.filter { it !in userCache }
        if (newUserIds.isEmpty()) {
            _uiState.value = _uiState.value.copy(
                participantUsers = userCache.filterKeys { it in allParticipantIds }
            )
            return
        }

        viewModelScope.launch {
            for (uid in newUserIds) {
                when (val result = userRepository.getUser(uid)) {
                    is Resource.Success -> userCache[uid] = result.data
                    else -> {}
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

    fun clearError() {
        _uiState.value = _uiState.value.copy(error = null)
    }

    fun onAudioPermissionResult(granted: Boolean) {
        _uiState.value = _uiState.value.copy(hasAudioPermission = granted)
        if (granted && isSeated) {
            val channelName = _uiState.value.room?.agoraChannelName ?: return
            joinVoiceChannel(channelName)
        }
    }

    override fun onCleared() {
        super.onCleared()
        ownerAwayCountdownJob?.cancel()
        presenceService.removePresence()
        agoraVoiceService.leaveChannel()
    }
}
