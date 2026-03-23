package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import com.shyden.shytalk.core.util.Constants
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertSame
import org.junit.Test
import java.util.Date

class ChatRoomFromMapTest {
    private val tsMillis = 1_000_000_000L
    private val ts = Timestamp(Date(tsMillis))

    @Test
    fun `fromMap parses complete valid map`() {
        val map =
            mapOf<String, Any?>(
                "name" to "My Room",
                "ownerId" to "owner-1",
                "state" to "ACTIVE",
                "createdAt" to ts,
                "participantIds" to listOf("owner-1", "user-2"),
                "hostIds" to listOf("user-2"),
                "requireApproval" to true,
                "bannedUserIds" to listOf("banned-1"),
                "voiceRoomName" to "channel-1",
                "seats" to
                    mapOf(
                        "0" to mapOf("userId" to "owner-1", "state" to "OCCUPIED", "isMuted" to false),
                    ),
            )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals("room-1", room.roomId)
        assertEquals("My Room", room.name)
        assertEquals("owner-1", room.ownerId)
        assertEquals(RoomState.ACTIVE, room.state)
        assertEquals(setOf("owner-1", "user-2"), room.participantIds)
        assertEquals(setOf("user-2"), room.hostIds)
        assertEquals(true, room.requireApproval)
        assertEquals(setOf("banned-1"), room.bannedUserIds)
        assertEquals("channel-1", room.voiceRoomName)
        assertEquals("owner-1", room.seats["0"]?.userId)
    }

    @Test
    fun `fromMap defaults name to empty string when missing`() {
        val room = ChatRoom.fromMap(emptyMap(), "room-1")
        assertEquals("", room.name)
    }

    @Test
    fun `fromMap defaults state to ACTIVE for invalid value`() {
        val map = mapOf<String, Any?>("state" to "INVALID")
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals(RoomState.ACTIVE, room.state)
    }

    @Test
    fun `fromMap defaults state to ACTIVE when missing`() {
        val room = ChatRoom.fromMap(emptyMap(), "room-1")
        assertEquals(RoomState.ACTIVE, room.state)
    }

    @Test
    fun `fromMap parses OWNER_AWAY state`() {
        val map = mapOf<String, Any?>("state" to "OWNER_AWAY")
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals(RoomState.OWNER_AWAY, room.state)
    }

    @Test
    fun `fromMap parses CLOSED state`() {
        val map = mapOf<String, Any?>("state" to "CLOSED")
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals(RoomState.CLOSED, room.state)
    }

    @Test
    fun `fromMap filters non-string items from participantIds`() {
        val map =
            mapOf<String, Any?>(
                "participantIds" to listOf("user-1", 42, null, "user-2"),
            )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals(setOf("user-1", "user-2"), room.participantIds)
    }

    @Test
    fun `fromMap defaults participantIds to empty when missing`() {
        val room = ChatRoom.fromMap(emptyMap(), "room-1")
        assertEquals(emptySet<String>(), room.participantIds)
    }

    @Test
    fun `fromMap creates all MAX_SEATS seats even when map has partial data`() {
        val map =
            mapOf<String, Any?>(
                "seats" to mapOf("0" to mapOf("userId" to "owner-1", "state" to "OCCUPIED")),
            )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals(Constants.MAX_SEATS, room.seats.size)
        assertEquals("owner-1", room.seats["0"]?.userId)
        assertNull(room.seats["1"]?.userId)
    }

    @Test
    fun `fromMap handles empty map with all defaults`() {
        val room = ChatRoom.fromMap(emptyMap(), "room-1")
        assertEquals("room-1", room.roomId)
        assertEquals("", room.name)
        assertEquals("", room.ownerId)
        assertEquals(RoomState.ACTIVE, room.state)
        assertEquals(emptySet<String>(), room.participantIds)
        assertEquals(emptySet<String>(), room.hostIds)
        assertFalse(room.requireApproval)
        assertEquals(emptySet<String>(), room.bannedUserIds)
        assertEquals(emptyMap<String, String>(), room.pendingInvites)
        assertEquals(Constants.MAX_SEATS, room.seats.size)
    }

    @Test
    fun `fromMap parses pendingInvites with string values`() {
        val map =
            mapOf<String, Any?>(
                "pendingInvites" to mapOf("user-1" to "inviter-1", "user-2" to "inviter-2"),
            )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals("inviter-1", room.pendingInvites["user-1"])
        assertEquals("inviter-2", room.pendingInvites["user-2"])
    }

    @Test
    fun `fromMap defaults requireApproval to false when missing`() {
        val room = ChatRoom.fromMap(emptyMap(), "room-1")
        assertFalse(room.requireApproval)
    }

    @Test
    fun `toMap produces correct map`() {
        val room =
            ChatRoom(
                roomId = "room-1",
                name = "My Room",
                ownerId = "owner-1",
                state = RoomState.ACTIVE,
                createdAt = tsMillis,
                participantIds = setOf("owner-1"),
                requireApproval = true,
                voiceRoomName = "ch-1",
            )
        val map = room.toMap()
        assertEquals("room-1", map["roomId"])
        assertEquals("My Room", map["name"])
        assertEquals("owner-1", map["ownerId"])
        assertEquals("ACTIVE", map["state"])
        assertEquals(tsMillis, map["createdAt"])
        assertEquals(true, map["requireApproval"])
    }

    @Test
    fun `toMap seats are serialized as nested maps`() {
        val room =
            ChatRoom(
                roomId = "room-1",
                createdAt = tsMillis,
                seats = mapOf("0" to Seat(userId = "owner-1", state = SeatState.OCCUPIED)),
            )
        val map = room.toMap()

        @Suppress("UNCHECKED_CAST")
        val seatsMap = map["seats"] as Map<String, Map<String, Any?>>
        assertEquals("owner-1", seatsMap["0"]?.get("userId"))
        assertEquals("OCCUPIED", seatsMap["0"]?.get("state"))
    }

    @Test
    fun `fromMap of toMap produces equivalent room`() {
        val seats =
            (0 until Constants.MAX_SEATS).associate { i ->
                i.toString() to
                    if (i == 0) {
                        Seat(userId = "owner-1", state = SeatState.OCCUPIED)
                    } else {
                        Seat()
                    }
            }
        val original =
            ChatRoom(
                roomId = "room-1",
                name = "Test Room",
                ownerId = "owner-1",
                state = RoomState.ACTIVE,
                createdAt = tsMillis,
                participantIds = setOf("owner-1", "user-2"),
                hostIds = setOf("user-2"),
                requireApproval = true,
                bannedUserIds = setOf("banned-1"),
                pendingInvites = mapOf("user-3" to "owner-1"),
                seats = seats,
                voiceRoomName = "channel-1",
                firstJoinTimestamps = mapOf("owner-1" to tsMillis),
            )
        val roundtripped = ChatRoom.fromMap(original.toMap(), "room-1")
        assertEquals(original, roundtripped)
    }

    // --- resolveRole ---

    @Test
    fun `resolveRole returns OWNER when userId matches ownerId`() {
        val room = ChatRoom(roomId = "r", ownerId = "user-1")
        assertEquals(RoomRole.OWNER, room.resolveRole("user-1"))
    }

    @Test
    fun `resolveRole returns HOST when userId in hostIds`() {
        val room = ChatRoom(roomId = "r", ownerId = "owner", hostIds = setOf("host-1"))
        assertEquals(RoomRole.HOST, room.resolveRole("host-1"))
    }

    @Test
    fun `resolveRole returns ATTENDEE for regular user`() {
        val room = ChatRoom(roomId = "r", ownerId = "owner")
        assertEquals(RoomRole.ATTENDEE, room.resolveRole("other"))
    }

    @Test
    fun `resolveRole prioritizes OWNER over HOST`() {
        val room = ChatRoom(roomId = "r", ownerId = "user-1", hostIds = setOf("user-1"))
        assertEquals(RoomRole.OWNER, room.resolveRole("user-1"))
    }

    // --- DEFAULT_SEATS ---

    @Test
    fun `fromMap reads legacy agoraChannelName key for backward compat`() {
        val map =
            mapOf<String, Any?>(
                "agoraChannelName" to "legacy-channel",
            )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals("legacy-channel", room.voiceRoomName)
    }

    @Test
    fun `fromMap prefers voiceRoomName over agoraChannelName`() {
        val map =
            mapOf<String, Any?>(
                "voiceRoomName" to "new-room",
                "agoraChannelName" to "old-channel",
            )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals("new-room", room.voiceRoomName)
    }

    @Test
    fun `DEFAULT_SEATS has MAX_SEATS entries all empty`() {
        val seats = ChatRoom.DEFAULT_SEATS
        assertEquals(Constants.MAX_SEATS, seats.size)
        seats.values.forEach { seat ->
            assertNull(seat.userId)
            assertEquals(SeatState.EMPTY, seat.state)
            assertFalse(seat.isMuted)
        }
    }

    @Test
    fun `default constructor uses DEFAULT_SEATS`() {
        val room = ChatRoom()
        assertEquals(ChatRoom.DEFAULT_SEATS, room.seats)
    }

    @Test
    fun `DEFAULT_SEATS is same instance on repeated access`() {
        // Verifies the constant is not re-computed each time
        assertSame(ChatRoom.DEFAULT_SEATS, ChatRoom.DEFAULT_SEATS)
    }

    @Test
    fun `DEFAULT_SEATS keys are zero-indexed strings`() {
        val expectedKeys = (0 until Constants.MAX_SEATS).map { it.toString() }.toSet()
        assertEquals(expectedKeys, ChatRoom.DEFAULT_SEATS.keys)
    }

    // --- lastGiftEvent ---

    @Test
    fun `fromMap parses lastGiftEvent`() {
        val map =
            mapOf<String, Any?>(
                "lastGiftEvent" to
                    mapOf(
                        "senderId" to "sender-1",
                        "senderName" to "Alice",
                        "recipientId" to "recipient-1",
                        "recipientName" to "Bob",
                        "giftId" to "crown",
                        "giftName" to "Crown",
                        "coinValue" to 800L,
                        "timestamp" to ts,
                    ),
            )
        val room = ChatRoom.fromMap(map, "room-1")
        val event = room.lastGiftEvent
        assertEquals("sender-1", event?.senderId)
        assertEquals("Alice", event?.senderName)
        assertEquals("recipient-1", event?.recipientId)
        assertEquals("Bob", event?.recipientName)
        assertEquals("crown", event?.giftId)
        assertEquals("Crown", event?.giftName)
        assertEquals(800, event?.coinValue)
        assertEquals(tsMillis, event?.timestamp)
    }

    @Test
    fun `fromMap defaults lastGiftEvent to null when missing`() {
        val room = ChatRoom.fromMap(emptyMap(), "room-1")
        assertNull(room.lastGiftEvent)
    }

    @Test
    fun `fromMap defaults lastGiftEvent to null when null`() {
        val map = mapOf<String, Any?>("lastGiftEvent" to null)
        val room = ChatRoom.fromMap(map, "room-1")
        assertNull(room.lastGiftEvent)
    }

    @Test
    fun `toMap serializes lastGiftEvent`() {
        val event =
            GiftEvent(
                senderId = "s1",
                senderName = "Alice",
                recipientId = "r1",
                recipientName = "Bob",
                giftId = "rose",
                giftName = "Rose",
                coinValue = 10,
                timestamp = tsMillis,
            )
        val room = ChatRoom(roomId = "room-1", createdAt = tsMillis, lastGiftEvent = event)
        val map = room.toMap()

        @Suppress("UNCHECKED_CAST")
        val eventMap = map["lastGiftEvent"] as Map<String, Any?>
        assertEquals("s1", eventMap["senderId"])
        assertEquals("Alice", eventMap["senderName"])
        assertEquals("r1", eventMap["recipientId"])
        assertEquals("Bob", eventMap["recipientName"])
        assertEquals("rose", eventMap["giftId"])
        assertEquals("Rose", eventMap["giftName"])
        assertEquals(10, eventMap["coinValue"])
    }

    @Test
    fun `toMap serializes null lastGiftEvent`() {
        val room = ChatRoom(roomId = "room-1", createdAt = tsMillis, lastGiftEvent = null)
        val map = room.toMap()
        assertNull(map["lastGiftEvent"])
    }

    // --- Additional edge cases ---

    @Test
    fun `fromMap with empty seats map produces all default seats`() {
        val map =
            mapOf<String, Any?>(
                "seats" to emptyMap<String, Any>(),
            )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals(Constants.MAX_SEATS, room.seats.size)
        room.seats.values.forEach { seat ->
            assertNull(seat.userId)
            assertEquals(SeatState.EMPTY, seat.state)
            assertFalse(seat.isMuted)
        }
    }

    @Test
    fun `fromMap with null participantIds defaults to empty set`() {
        val map =
            mapOf<String, Any?>(
                "participantIds" to null,
            )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals(emptySet<String>(), room.participantIds)
    }

    @Test
    fun `fromMap with lastGiftEvent partial map populates known fields with defaults for rest`() {
        val map =
            mapOf<String, Any?>(
                "lastGiftEvent" to
                    mapOf(
                        "senderId" to "sender-1",
                        "giftId" to "rose",
                    ),
            )
        val room = ChatRoom.fromMap(map, "room-1")
        val event = room.lastGiftEvent

        assertEquals("sender-1", event?.senderId)
        assertEquals("", event?.senderName)
        assertEquals("", event?.recipientId)
        assertEquals("", event?.recipientName)
        assertEquals("rose", event?.giftId)
        assertEquals("", event?.giftName)
        assertEquals(0, event?.coinValue)
        assertEquals(0L, event?.timestamp)
    }

    @Test
    fun `fromMap with null hostIds defaults to empty set`() {
        val map =
            mapOf<String, Any?>(
                "hostIds" to null,
            )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals(emptySet<String>(), room.hostIds)
    }

    @Test
    fun `fromMap with null bannedUserIds defaults to empty set`() {
        val map =
            mapOf<String, Any?>(
                "bannedUserIds" to null,
            )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals(emptySet<String>(), room.bannedUserIds)
    }

    @Test
    fun `fromMap with null seats produces all default seats`() {
        val map =
            mapOf<String, Any?>(
                "seats" to null,
            )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals(Constants.MAX_SEATS, room.seats.size)
        room.seats.values.forEach { seat ->
            assertNull(seat.userId)
            assertEquals(SeatState.EMPTY, seat.state)
        }
    }

    @Test
    fun `fromMap with kickInfo map parses correctly`() {
        val map =
            mapOf<String, Any?>(
                "kickInfo" to
                    mapOf(
                        "user-1" to mapOf("reason" to "spam", "kickedBy" to "owner-1"),
                    ),
            )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals("spam", room.kickInfo["user-1"]?.get("reason"))
        assertEquals("owner-1", room.kickInfo["user-1"]?.get("kickedBy"))
    }

    @Test
    fun `fromMap with null kickInfo defaults to empty map`() {
        val map =
            mapOf<String, Any?>(
                "kickInfo" to null,
            )
        val room = ChatRoom.fromMap(map, "room-1")
        assertEquals(emptyMap<String, Map<String, String>>(), room.kickInfo)
    }
}
