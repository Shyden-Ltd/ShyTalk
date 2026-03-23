package com.shyden.shytalk.testdata

import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.model.ConversationPreview
import com.shyden.shytalk.core.model.CurrencyType
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.MessageType
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.Transaction
import com.shyden.shytalk.core.model.TransactionType
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.feature.legal.CURRENT_LEGAL_VERSION

object TestData {
    val currentUser =
        User(
            uid = "test-user-1",
            displayName = "TestUser",
            uniqueId = 10000001L,
            dateOfBirth = 946684800000L, // 2000-01-01
            acceptedLegalVersion = CURRENT_LEGAL_VERSION,
            shyCoins = 1000,
            loginStreak = 3,
            lastLoginRewardDate = "2020-01-01", // old date ensures daily reward is claimable
        )

    val otherUser =
        User(
            uid = "test-user-2",
            displayName = "OtherUser",
            uniqueId = 10000002L,
            dateOfBirth = 946684800000L,
            acceptedLegalVersion = CURRENT_LEGAL_VERSION,
            shyCoins = 500,
        )

    val sampleRooms =
        listOf(
            ChatRoom(
                roomId = "room-1",
                name = "Chill Zone",
                ownerId = "test-user-2",
                state = RoomState.ACTIVE,
                participantIds = setOf("test-user-2"),
                voiceRoomName = "voice-room-1",
            ),
            ChatRoom(
                roomId = "room-2",
                name = "Music Room",
                ownerId = "test-user-1",
                state = RoomState.ACTIVE,
                participantIds = setOf("test-user-1"),
                voiceRoomName = "voice-room-2",
            ),
        )

    val sampleRoomMessages =
        listOf(
            Message(
                messageId = "msg-1",
                senderId = "test-user-2",
                senderName = "OtherUser",
                text = "Welcome to the room!",
                type = MessageType.TEXT,
                createdAt = 1000000000L,
            ),
            Message(
                messageId = "msg-2",
                senderId = "",
                senderName = "",
                text = "TestUser joined the room",
                type = MessageType.SYSTEM,
                createdAt = 1000000001L,
            ),
        )

    val sampleConversations =
        listOf(
            Conversation(
                conversationId = "conv-1",
                participantIds = listOf("test-user-1", "test-user-2"),
                lastMessage =
                    ConversationPreview(
                        text = "Hey there!",
                        senderId = "test-user-2",
                        senderName = "OtherUser",
                        createdAt = 1000000000L,
                    ),
                lastMessageAt = 1000000000L,
            ),
        )

    val sampleGifts =
        listOf(
            Gift(
                id = "gift-heart",
                name = "Heart",
                coinValue = 10,
                iconUrl = "",
                order = 1,
            ),
            Gift(
                id = "gift-diamond",
                name = "Diamond",
                coinValue = 5000,
                iconUrl = "",
                order = 2,
            ),
        )

    val sampleTransactions =
        listOf(
            Transaction(
                id = "tx-1",
                type = TransactionType.DAILY_REWARD,
                amount = 50,
                currency = CurrencyType.COINS,
                balanceAfter = 1000,
                details = "Daily login reward",
                timestamp = 1000000000L,
            ),
        )
}
