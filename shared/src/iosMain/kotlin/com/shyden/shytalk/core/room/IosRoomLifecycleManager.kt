package com.shyden.shytalk.core.room

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.data.repository.AuthRepository
import kotlinx.coroutines.CompletableDeferred
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow

class IosRoomLifecycleManager(
    private val authRepository: AuthRepository,
) : RoomLifecycleManager {
    private val _activeRoomId = MutableStateFlow<String?>(null)
    override val activeRoomId: StateFlow<String?> = _activeRoomId.asStateFlow()

    private val _activeRoom = MutableStateFlow<ChatRoom?>(null)
    override val activeRoom: StateFlow<ChatRoom?> = _activeRoom.asStateFlow()

    private val _activeMessages = MutableStateFlow<List<Message>>(emptyList())
    override val activeMessages: StateFlow<List<Message>> = _activeMessages.asStateFlow()

    override val currentUserId: String
        get() = authRepository.currentUserId ?: ""

    override var isAppInForeground: Boolean = true

    private val _disconnectedUserIds = MutableStateFlow<Set<String>>(emptySet())
    override val disconnectedUserIds: StateFlow<Set<String>> = _disconnectedUserIds.asStateFlow()

    private val _sharedUserCache = mutableMapOf<String, User>()
    override val sharedUserCache: Map<String, User> get() = _sharedUserCache

    private val leaveCompletions = mutableMapOf<String, CompletableDeferred<Unit>>()

    override fun isInRoom(roomId: String): Boolean = _activeRoomId.value == roomId

    override fun trackRoom(roomId: String) {
        _activeRoomId.value = roomId
    }

    override fun updateTrackedRoom(room: ChatRoom) {
        _activeRoom.value = room
    }

    override fun updateSharedUserCache(users: Map<String, User>) {
        _sharedUserCache.putAll(users)
    }

    override fun untrackRoom() {
        _activeRoomId.value = null
        _activeRoom.value = null
        _activeMessages.value = emptyList()
        _disconnectedUserIds.value = emptySet()
    }

    override fun setRoomScreenVisible(visible: Boolean) {
        // iOS doesn't need foreground service management
    }

    override fun markLeaveStarted(roomId: String) {
        leaveCompletions[roomId] = CompletableDeferred()
    }

    override fun markLeaveCompleted(roomId: String) {
        leaveCompletions.remove(roomId)?.complete(Unit)
    }

    override suspend fun awaitLeaveCompletion(roomId: String) {
        leaveCompletions[roomId]?.await()
    }
}
