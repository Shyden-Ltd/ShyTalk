package com.shyden.shytalk.testutil

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.MessageType
import com.shyden.shytalk.core.model.ProfileVisitor
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.model.SeatRequestStatus
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User

object TestData {

    val BASE_TIMESTAMP = 1_000_000_000L
    val LATER_TIMESTAMP = 2_000_000_000L

    fun createTestUser(
        uid: String = "user-1",
        displayName: String = "Test User",
        blockedUserIds: Set<String> = emptySet(),
        profilePhotoUrl: String? = null,
        coverPhotoUrl: String? = null,
        uniqueId: Long = 12345L,
        dateOfBirth: Long? = null,
        hideAge: Boolean = false,
        followerIds: Set<String> = emptySet(),
        followingIds: Set<String> = emptySet(),
        hideFollowing: Boolean = false,
        stalkerCount: Long = 0,
        newStalkerCount: Long = 0,
        stalkersLastViewedAt: Long = 0,
        isSuspended: Boolean = false,
        suspensionReason: String? = null,
        suspensionStartDate: Long? = null,
        suspensionEndDate: Long? = null,
        suspensionCanAppeal: Boolean = false,
        suspendedBy: String? = null,
        suspensionAppealStatus: String? = null
    ) = User(
        uid = uid,
        displayName = displayName,
        blockedUserIds = blockedUserIds,
        profilePhotoUrl = profilePhotoUrl,
        coverPhotoUrl = coverPhotoUrl,
        uniqueId = uniqueId,
        dateOfBirth = dateOfBirth,
        hideAge = hideAge,
        followerIds = followerIds,
        followingIds = followingIds,
        hideFollowing = hideFollowing,
        stalkerCount = stalkerCount,
        newStalkerCount = newStalkerCount,
        stalkersLastViewedAt = stalkersLastViewedAt,
        createdAt = BASE_TIMESTAMP,
        lastSeenAt = BASE_TIMESTAMP,
        isSuspended = isSuspended,
        suspensionReason = suspensionReason,
        suspensionStartDate = suspensionStartDate,
        suspensionEndDate = suspensionEndDate,
        suspensionCanAppeal = suspensionCanAppeal,
        suspendedBy = suspendedBy,
        suspensionAppealStatus = suspensionAppealStatus
    )

    fun createTestProfileVisitor(
        visitorId: String = "visitor-1",
        visitCount: Long = 1,
        lastVisitedAt: Long = LATER_TIMESTAMP,
        firstVisitedAt: Long = BASE_TIMESTAMP
    ) = ProfileVisitor(
        visitorId = visitorId,
        visitCount = visitCount,
        lastVisitedAt = lastVisitedAt,
        firstVisitedAt = firstVisitedAt
    )

    fun createTestSeat(
        userId: String? = null,
        state: SeatState = if (userId != null) SeatState.OCCUPIED else SeatState.EMPTY,
        isMuted: Boolean = false
    ) = Seat(userId = userId, state = state, isMuted = isMuted)

    fun createDefaultSeats(): Map<String, Seat> = ChatRoom.DEFAULT_SEATS

    fun createSeatsWithOwner(ownerId: String): Map<String, Seat> {
        val seats = createDefaultSeats().toMutableMap()
        seats["0"] = createTestSeat(userId = ownerId)
        return seats
    }

    fun createTestRoom(
        roomId: String = "room-1",
        name: String = "Test Room",
        ownerId: String = "owner-1",
        state: RoomState = RoomState.ACTIVE,
        participantIds: Set<String> = setOf(ownerId),
        hostIds: Set<String> = emptySet(),
        requireApproval: Boolean = false,
        bannedUserIds: Set<String> = emptySet(),
        kickInfo: Map<String, Map<String, String>> = emptyMap(),
        pendingInvites: Map<String, String> = emptyMap(),
        seats: Map<String, Seat> = createSeatsWithOwner(ownerId),
        voiceRoomName: String = "channel-1",
        firstJoinTimestamps: Map<String, Long> = emptyMap(),
        createdAt: Long = System.currentTimeMillis(),
        ownerLeftAt: Long? = null,
        closedAt: Long? = null,
        allTimeHostIds: Set<String> = emptySet(),
        allTimeSeatUserIds: Set<String> = emptySet()
    ) = ChatRoom(
        roomId = roomId,
        name = name,
        ownerId = ownerId,
        state = state,
        participantIds = participantIds,
        hostIds = hostIds,
        requireApproval = requireApproval,
        bannedUserIds = bannedUserIds,
        kickInfo = kickInfo,
        pendingInvites = pendingInvites,
        seats = seats,
        voiceRoomName = voiceRoomName,
        firstJoinTimestamps = firstJoinTimestamps,
        createdAt = createdAt,
        ownerLeftAt = ownerLeftAt,
        closedAt = closedAt,
        allTimeHostIds = allTimeHostIds,
        allTimeSeatUserIds = allTimeSeatUserIds
    )

    fun createTestMessage(
        messageId: String = "msg-1",
        senderId: String = "user-1",
        senderName: String = "Test User",
        text: String = "Hello",
        type: MessageType = MessageType.TEXT,
        createdAt: Long = BASE_TIMESTAMP
    ) = Message(
        messageId = messageId,
        senderId = senderId,
        senderName = senderName,
        text = text,
        type = type,
        createdAt = createdAt
    )

    fun createTestSeatRequest(
        requestId: String = "req-1",
        userId: String = "user-1",
        userName: String = "Test User",
        seatIndex: Int = 3,
        status: SeatRequestStatus = SeatRequestStatus.PENDING,
        createdAt: Long = BASE_TIMESTAMP,
        resolvedBy: String? = null,
        resolvedAt: Long? = null
    ) = SeatRequest(
        requestId = requestId,
        userId = userId,
        userName = userName,
        seatIndex = seatIndex,
        status = status,
        createdAt = createdAt,
        resolvedBy = resolvedBy,
        resolvedAt = resolvedAt
    )
}
