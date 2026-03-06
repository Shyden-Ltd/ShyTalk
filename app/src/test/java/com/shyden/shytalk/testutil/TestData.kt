package com.shyden.shytalk.testutil

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.CurrencyType
import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.model.ConversationPreview
import com.shyden.shytalk.core.model.ConversationSettings
import com.shyden.shytalk.core.model.DailyRewardResult
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.GiftRankEntry
import com.shyden.shytalk.core.model.GiftSender
import com.shyden.shytalk.core.model.GiftWallEntry
import com.shyden.shytalk.core.model.GroupPermissions
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.MessageType
import com.shyden.shytalk.core.model.PrivateMessage
import com.shyden.shytalk.core.model.PrivateMessageType
import com.shyden.shytalk.core.model.ProfileVisitor
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.model.SeatRequestStatus
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.Transaction
import com.shyden.shytalk.core.model.TransactionType
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.feature.messaging.Report

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
        suspensionAppealStatus: String? = null,
        isSuperShy: Boolean = false,
        language: String = "en"
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
        suspensionAppealStatus = suspensionAppealStatus,
        isSuperShy = isSuperShy,
        language = language
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

    fun createTestPrivateMessage(
        messageId: String = "pm-1",
        senderId: String = "user-1",
        senderName: String = "Test User",
        text: String = "Hello PM",
        imageUrls: List<String> = emptyList(),
        type: PrivateMessageType = PrivateMessageType.TEXT,
        createdAt: Long = BASE_TIMESTAMP,
        editedAt: Long? = null,
        editCount: Long = 0,
        readBy: List<String> = emptyList(),
        replyToMessageId: String? = null,
        replyToText: String? = null,
        replyToSenderName: String? = null,
        reactions: Map<String, List<String>> = emptyMap(),
        roomInviteId: String? = null,
        roomInviteName: String? = null
    ) = PrivateMessage(
        messageId = messageId,
        senderId = senderId,
        senderName = senderName,
        text = text,
        imageUrls = imageUrls,
        type = type,
        createdAt = createdAt,
        editedAt = editedAt,
        editCount = editCount,
        readBy = readBy,
        replyToMessageId = replyToMessageId,
        replyToText = replyToText,
        replyToSenderName = replyToSenderName,
        reactions = reactions,
        roomInviteId = roomInviteId,
        roomInviteName = roomInviteName
    )

    fun createTestConversation(
        conversationId: String = "conv-1",
        participantIds: List<String> = listOf("user-1", "user-2"),
        lastMessage: ConversationPreview? = null,
        lastMessageAt: Long = BASE_TIMESTAMP,
        createdAt: Long = BASE_TIMESTAMP,
        isGroup: Boolean = false,
        groupName: String? = null,
        groupPhotoUrl: String? = null,
        groupAdminIds: List<String> = emptyList(),
        groupModIds: List<String> = emptyList(),
        groupDescription: String? = null,
        createdBy: String? = null,
        isClosed: Boolean = false,
        permissions: GroupPermissions = GroupPermissions(),
        modNotifyMode: String = "ALL_ADMINS",
        settings: ConversationSettings? = null
    ) = Conversation(
        conversationId = conversationId,
        participantIds = participantIds,
        lastMessage = lastMessage,
        lastMessageAt = lastMessageAt,
        createdAt = createdAt,
        isGroup = isGroup,
        groupName = groupName,
        groupPhotoUrl = groupPhotoUrl,
        groupAdminIds = groupAdminIds,
        groupModIds = groupModIds,
        groupDescription = groupDescription,
        createdBy = createdBy,
        isClosed = isClosed,
        permissions = permissions,
        modNotifyMode = modNotifyMode,
        settings = settings
    )

    fun createTestConversationPreview(
        text: String = "Last msg",
        senderId: String = "user-1",
        senderName: String = "Test User",
        createdAt: Long = BASE_TIMESTAMP,
        type: String = "TEXT"
    ) = ConversationPreview(
        text = text,
        senderId = senderId,
        senderName = senderName,
        createdAt = createdAt,
        type = type
    )

    fun createTestConversationSettings(
        userId: String = "user-1",
        isMuted: Boolean = false,
        isHidden: Boolean = false,
        hiddenAt: Long? = null,
        isPinned: Boolean = false,
        lastReadMessageId: String = "",
        lastReadAt: Long = 0,
        unreadCount: Long = 0
    ) = ConversationSettings(
        userId = userId,
        isMuted = isMuted,
        isHidden = isHidden,
        hiddenAt = hiddenAt,
        isPinned = isPinned,
        lastReadMessageId = lastReadMessageId,
        lastReadAt = lastReadAt,
        unreadCount = unreadCount
    )

    fun createTestGift(
        id: String = "gift-1",
        name: String = "Rose",
        coinValue: Int = 10,
        animationUrl: String = "",
        soundUrl: String = "",
        iconUrl: String = "",
        order: Int = 1
    ) = Gift(
        id = id,
        name = name,
        coinValue = coinValue,
        animationUrl = animationUrl,
        soundUrl = soundUrl,
        iconUrl = iconUrl,
        order = order
    )

    fun createTestGiftWallEntry(
        giftId: String = "gift-1",
        receivedCount: Int = 5,
        senders: Map<String, Int> = emptyMap(),
        topSenderId: String? = null,
        topSenderCount: Int = 0
    ) = GiftWallEntry(
        giftId = giftId,
        receivedCount = receivedCount,
        senders = senders,
        topSenderId = topSenderId,
        topSenderCount = topSenderCount
    )

    fun createTestTransaction(
        id: String = "tx-1",
        type: TransactionType = TransactionType.PURCHASE,
        amount: Long = 100,
        currency: CurrencyType = CurrencyType.COINS,
        balanceAfter: Long = 900,
        giftId: String? = null,
        giftName: String? = null,
        recipientId: String? = null,
        senderId: String? = null,
        pullCount: Int? = null,
        details: String? = null,
        timestamp: Long = BASE_TIMESTAMP
    ) = Transaction(
        id = id,
        type = type,
        amount = amount,
        currency = currency,
        balanceAfter = balanceAfter,
        giftId = giftId,
        giftName = giftName,
        recipientId = recipientId,
        senderId = senderId,
        pullCount = pullCount,
        details = details,
        timestamp = timestamp
    )

    fun createTestDailyRewardResult(
        coinsAwarded: Int = 50,
        newStreak: Int = 1,
        isMilestone: Boolean = false,
        newBalance: Long = 150
    ) = DailyRewardResult(
        coinsAwarded = coinsAwarded,
        newStreak = newStreak,
        isMilestone = isMilestone,
        newBalance = newBalance
    )

    fun createTestReport(
        reportId: String = "report-1",
        reporterId: String = "reporter-1",
        reporterName: String = "Reporter",
        reportedUserId: String = "reported-1",
        reportedUserName: String = "Reported User",
        reason: String = "Spam",
        description: String = "Spamming messages",
        type: String = "message",
        status: String = "pending",
        timestamp: Long = BASE_TIMESTAMP
    ) = Report(
        reportId = reportId,
        reporterId = reporterId,
        reporterName = reporterName,
        reportedUserId = reportedUserId,
        reportedUserName = reportedUserName,
        reason = reason,
        description = description,
        type = type,
        status = status,
        timestamp = timestamp
    )

    fun createTestGiftSender(
        userId: String = "sender-1",
        count: Int = 3
    ) = GiftSender(userId = userId, count = count)

    fun createTestGiftRankEntry(
        userId: String = "user-1",
        count: Int = 10,
        displayName: String = "Test User",
        profilePhotoUrl: String? = null
    ) = GiftRankEntry(
        userId = userId,
        count = count,
        displayName = displayName,
        profilePhotoUrl = profilePhotoUrl
    )
}
