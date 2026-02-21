package com.shyden.shytalk.fake

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.RoomRepository
import com.shyden.shytalk.testdata.TestData
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map

class FakeRoomRepository : RoomRepository {
    val rooms = MutableStateFlow(TestData.sampleRooms)

    override fun getActiveRooms(): Flow<List<ChatRoom>> = rooms

    override fun getRoomFlow(roomId: String): Flow<ChatRoom?> =
        rooms.map { list -> list.find { it.roomId == roomId } }

    override suspend fun createRoom(name: String, ownerId: String): Resource<String> {
        val newRoom = ChatRoom(roomId = "room-new", name = name, ownerId = ownerId)
        rooms.value = rooms.value + newRoom
        return Resource.Success("room-new")
    }

    override suspend fun joinRoom(roomId: String, userId: String): Resource<Unit> = Resource.Success(Unit)
    override suspend fun leaveRoom(roomId: String, userId: String): Resource<Unit> = Resource.Success(Unit)
    override suspend fun takeSeat(roomId: String, seatIndex: Int, userId: String): Resource<Unit> = Resource.Success(Unit)
    override suspend fun leaveSeat(roomId: String, seatIndex: Int): Resource<Unit> = Resource.Success(Unit)
    override suspend fun removeFromSeat(roomId: String, seatIndex: Int): Resource<Unit> = Resource.Success(Unit)
    override suspend fun moveSeat(roomId: String, fromIndex: Int, toIndex: Int, userId: String): Resource<Unit> = Resource.Success(Unit)
    override suspend fun kickUser(roomId: String, userId: String, seatIndex: Int?, kickerName: String, reason: String): Resource<Unit> = Resource.Success(Unit)
    override suspend fun toggleMute(roomId: String, seatIndex: Int, isMuted: Boolean): Resource<Unit> = Resource.Success(Unit)
    override suspend fun addHost(roomId: String, userId: String): Resource<Unit> = Resource.Success(Unit)
    override suspend fun removeHost(roomId: String, userId: String): Resource<Unit> = Resource.Success(Unit)
    override suspend fun updateRoomName(roomId: String, newName: String): Resource<Unit> = Resource.Success(Unit)
    override suspend fun setRequireApproval(roomId: String, requireApproval: Boolean): Resource<Unit> = Resource.Success(Unit)
    override suspend fun setOwnerAway(roomId: String): Resource<Unit> = Resource.Success(Unit)
    override suspend fun setOwnerReturned(roomId: String, ownerId: String): Resource<Unit> = Resource.Success(Unit)
    override suspend fun sendInvite(roomId: String, userId: String, invitedBy: String): Resource<Unit> = Resource.Success(Unit)
    override suspend fun cancelInvite(roomId: String, userId: String): Resource<Unit> = Resource.Success(Unit)
    override suspend fun acceptInvite(roomId: String, userId: String, seatIndex: Int): Resource<Unit> = Resource.Success(Unit)
    override suspend fun closeRoom(roomId: String): Resource<Unit> = Resource.Success(Unit)
    override suspend fun findActiveRoomByOwner(ownerId: String): String? = null
    override suspend fun recordFirstJoinTimestamp(roomId: String, userId: String): Resource<Unit> = Resource.Success(Unit)
    override suspend fun leaveAllRooms(userId: String, exceptRoomId: String?): Resource<Unit> = Resource.Success(Unit)
    override suspend fun closeAllRoomsByOwner(ownerId: String): Resource<Unit> = Resource.Success(Unit)
    override suspend fun removeDisconnectedUser(roomId: String, userId: String): Resource<Unit> = Resource.Success(Unit)
}
