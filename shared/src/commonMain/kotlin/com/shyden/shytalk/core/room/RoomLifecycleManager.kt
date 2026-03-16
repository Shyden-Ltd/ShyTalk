package com.shyden.shytalk.core.room

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.User
import kotlinx.coroutines.flow.StateFlow

interface RoomLifecycleManager {
    val activeRoomId: StateFlow<String?>
    val activeRoom: StateFlow<ChatRoom?>
    val activeMessages: StateFlow<List<Message>>
    val currentUserId: String
    var isAppInForeground: Boolean
    val disconnectedUserIds: StateFlow<Set<String>>

    /** Shared user cache that survives ViewModel destruction. */
    val sharedUserCache: Map<String, User>

    fun isInRoom(roomId: String): Boolean

    fun trackRoom(roomId: String)

    fun updateTrackedRoom(room: ChatRoom)

    fun updateSharedUserCache(users: Map<String, User>)

    fun untrackRoom()

    fun setRoomScreenVisible(visible: Boolean)

    fun markLeaveStarted(roomId: String)

    fun markLeaveCompleted(roomId: String)

    suspend fun awaitLeaveCompletion(roomId: String)
}
