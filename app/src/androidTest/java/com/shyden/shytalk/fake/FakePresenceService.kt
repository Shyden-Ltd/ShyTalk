package com.shyden.shytalk.fake

import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.remote.RoomEvent
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flowOf

class FakePresenceService : PresenceService {
    override fun setPresence(
        roomId: String,
        userId: String,
    ) { /* no-op */ }

    override fun removePresence() { /* no-op */ }

    override fun observeRoomPresence(roomId: String): Flow<Set<String>> = flowOf(emptySet())

    override suspend fun isUserPresent(
        roomId: String,
        userId: String,
    ): Boolean = false

    override val roomEvents: Flow<RoomEvent> = MutableSharedFlow()

    override fun armOwnerLeftSignal(
        roomId: String,
        ownerFirebaseUid: String,
    ) { /* no-op */ }

    override fun cancelOwnerLeftSignal() { /* no-op */ }
}
