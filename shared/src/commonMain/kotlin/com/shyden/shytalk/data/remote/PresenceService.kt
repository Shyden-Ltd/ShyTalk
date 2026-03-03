package com.shyden.shytalk.data.remote

import kotlinx.coroutines.flow.Flow

interface PresenceService {
    fun setPresence(roomId: String, userId: String)
    fun removePresence()
    fun observeRoomPresence(roomId: String): Flow<Set<String>>

    /** Room events observed via Firebase RTDB listeners. */
    val roomEvents: Flow<RoomEvent>
}
