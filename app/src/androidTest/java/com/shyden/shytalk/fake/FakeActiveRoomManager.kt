package com.shyden.shytalk.fake

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.room.RoomLifecycleManager
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow

class FakeActiveRoomManager : RoomLifecycleManager {
    override val activeRoomId: StateFlow<String?> = MutableStateFlow(null)
    override val activeRoom: StateFlow<ChatRoom?> = MutableStateFlow(null)
    override val activeMessages: StateFlow<List<Message>> = MutableStateFlow(emptyList())
    override val currentUserId: String = "test-user-1"
    override var isAppInForeground: Boolean = false
    override val disconnectedUserIds: StateFlow<Set<String>> = MutableStateFlow(emptySet())
    override val sharedUserCache: Map<String, User> = emptyMap()

    private var trackedRoomId: String? = null

    override fun isInRoom(roomId: String): Boolean = trackedRoomId == roomId

    override fun trackRoom(roomId: String) {
        trackedRoomId = roomId
    }

    override fun updateTrackedRoom(room: ChatRoom) { /* no-op */ }

    override fun updateSharedUserCache(users: Map<String, User>) { /* no-op */ }

    override fun untrackRoom() {
        trackedRoomId = null
    }

    override fun setRoomScreenVisible(visible: Boolean) { /* no-op */ }

    override fun markLeaveStarted(roomId: String) { /* no-op */ }

    override fun markLeaveCompleted(roomId: String) { /* no-op */ }

    override suspend fun awaitLeaveCompletion(roomId: String) { /* no-op */ }
}
