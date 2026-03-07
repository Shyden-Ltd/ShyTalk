package com.shyden.shytalk.feature.settings

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.util.Constants.SEAT_REQUEST_IMMEDIATE_THRESHOLD_MS
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.LanguagePreference
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.data.repository.SeatRequestRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.async
import kotlinx.coroutines.awaitAll
import kotlinx.coroutines.coroutineScope
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class RoomSettingsUiState(
    val room: ChatRoom? = null,
    val pendingRequests: List<SeatRequest> = emptyList(),
    val userNames: Map<String, String> = emptyMap(),
    val minGiftAnimationValue: Int = 0,
    val isSuperShy: Boolean = false,
    val autoTranslate: Boolean = false,
    val isLoading: Boolean = false,
    val error: String? = null
)

class RoomSettingsViewModel(
    private val roomRepository: RoomRepository,
    private val seatRequestRepository: SeatRequestRepository,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(RoomSettingsUiState())
    val uiState: StateFlow<RoomSettingsUiState> = _uiState.asStateFlow()

    private var currentRoomId: String = ""

    val currentUserId: String
        get() = authRepository.currentUserId ?: ""

    fun loadRoom(roomId: String) {
        currentRoomId = roomId
        viewModelScope.launch {
            // Load the user's preferences and SuperShy status
            val uid = currentUserId
            if (uid.isNotEmpty()) {
                when (val result = userRepository.getUser(uid)) {
                    is Resource.Success -> {
                        _uiState.update {
                            it.copy(
                                minGiftAnimationValue = result.data.minGiftAnimationValue,
                                isSuperShy = result.data.isSuperShy,
                                autoTranslate = LanguagePreference.getAutoTranslate()
                            )
                        }
                    }
                    else -> {}
                }
            }
        }
        viewModelScope.launch {
            combine(
                roomRepository.getRoomFlow(roomId),
                seatRequestRepository.getPendingRequests(roomId)
            ) { room, requests ->
                room to requests
            }
                .catch { e ->
                    _uiState.update { it.copy(error = e.message) }
                }
                .collect { (room, requests) ->
                    _uiState.update { it.copy(room = room, pendingRequests = requests) }
                    if (room != null) {
                        resolveUserNames(room)
                    }
                }
        }
    }

    private val resolvedIds = mutableSetOf<String>()

    private suspend fun resolveUserNames(room: ChatRoom) {
        val allIds = room.participantIds + room.hostIds + room.ownerId
        val newIds = allIds.filter { it !in resolvedIds }
        if (newIds.isEmpty()) return

        val resolved = coroutineScope {
            newIds.map { id ->
                async {
                    when (val result = userRepository.getUser(id)) {
                        is Resource.Success -> id to result.data.displayName.ifEmpty { id.take(8) }
                        else -> null
                    }
                }
            }.awaitAll().filterNotNull()
        }

        if (resolved.isNotEmpty()) {
            val names = _uiState.value.userNames.toMutableMap()
            for ((id, name) in resolved) {
                names[id] = name
                resolvedIds.add(id)
            }
            _uiState.update { it.copy(userNames = names) }
        }
    }

    fun toggleRequireApproval() {
        val room = _uiState.value.room ?: return
        if (currentUserId != room.ownerId) return
        viewModelScope.launch {
            roomRepository.setRequireApproval(currentRoomId, !room.requireApproval)
        }
    }

    fun addHost(userId: String) {
        val room = _uiState.value.room ?: return
        if (currentUserId != room.ownerId) return
        viewModelScope.launch {
            roomRepository.addHost(currentRoomId, userId)
        }
    }

    fun removeHost(userId: String) {
        val room = _uiState.value.room ?: return
        if (currentUserId != room.ownerId) return
        viewModelScope.launch {
            roomRepository.removeHost(currentRoomId, userId)
        }
    }

    fun inviteUser(userId: String, userName: String) {
        val room = _uiState.value.room ?: return
        // Owner can always invite; hosts only when requireApproval is OFF
        if (currentUserId != room.ownerId && (currentUserId !in room.hostIds || room.requireApproval)) return
        // Don't invite someone already invited or already seated
        if (userId in room.pendingInvites) return
        if (room.findUserSeat(userId) != null) return
        viewModelScope.launch {
            roomRepository.sendInvite(currentRoomId, userId, currentUserId)
        }
    }

    fun approveRequest(request: SeatRequest) {
        val room = _uiState.value.room ?: return
        // When requireApproval is ON, only owner can approve
        if (room.requireApproval && currentUserId != room.ownerId) return
        // When OFF, owner + hosts can approve (attendees never see this)
        if (currentUserId != room.ownerId && currentUserId !in room.hostIds) return
        viewModelScope.launch {
            val nowMs = currentTimeMillis()
            val delayMs = nowMs - request.createdAt

            when (val result = seatRequestRepository.approveRequest(
                currentRoomId, request.requestId, currentUserId
            )) {
                is Resource.Success -> {
                    val approved = result.data
                    if (delayMs <= SEAT_REQUEST_IMMEDIATE_THRESHOLD_MS) {
                        roomRepository.takeSeat(currentRoomId, approved.seatIndex, approved.userId)
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(error = result.message) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun denyRequest(request: SeatRequest) {
        viewModelScope.launch {
            seatRequestRepository.denyRequest(currentRoomId, request.requestId, currentUserId)
        }
    }

    fun leaveSeat() {
        val room = _uiState.value.room ?: return
        val seatEntry = room.findUserSeat(currentUserId) ?: return
        if (currentUserId == room.ownerId) return
        viewModelScope.launch {
            roomRepository.leaveSeat(currentRoomId, seatEntry.key.toInt())
        }
    }

    fun requestSeat() {
        val room = _uiState.value.room ?: return
        if (currentUserId == room.ownerId) return
        if (room.findUserSeat(currentUserId) != null) return
        val isHost = currentUserId in room.hostIds
        if (!isHost && room.requireApproval) return
        viewModelScope.launch {
            val emptySeat = (1 until com.shyden.shytalk.core.util.Constants.MAX_SEATS).firstOrNull { i ->
                val seat = room.seats[i.toString()]
                seat != null && seat.state != com.shyden.shytalk.core.model.SeatState.OCCUPIED
            } ?: return@launch
            if (isHost) {
                // Hosts sit directly without a request
                roomRepository.takeSeat(currentRoomId, emptySeat, currentUserId)
            } else {
                val userName = _uiState.value.userNames[currentUserId] ?: ""
                seatRequestRepository.createRequest(
                    roomId = currentRoomId,
                    userId = currentUserId,
                    userName = userName,
                    seatIndex = emptySeat
                )
            }
        }
    }

    fun closeRoom() {
        val room = _uiState.value.room ?: return
        if (currentUserId != room.ownerId) return
        viewModelScope.launch {
            roomRepository.closeRoom(currentRoomId)
        }
    }

    fun toggleAutoTranslate() {
        val newValue = !_uiState.value.autoTranslate
        LanguagePreference.setAutoTranslate(newValue)
        _uiState.update { it.copy(autoTranslate = newValue) }
    }

    fun setMinGiftAnimationValue(value: Int) {
        _uiState.update { it.copy(minGiftAnimationValue = value) }
        viewModelScope.launch {
            userRepository.updateProfile(currentUserId, mapOf("minGiftAnimationValue" to value))
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
