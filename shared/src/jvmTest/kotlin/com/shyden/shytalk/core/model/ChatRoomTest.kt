package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.Constants
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ChatRoomTest {
    // ── fromMap basic ───────────────────────────────────────────────

    @Test
    fun `fromMap parses basic fields`() {
        val map =
            mapOf<String, Any?>(
                "name" to "Test Room",
                "ownerId" to "owner-1",
                "state" to "ACTIVE",
                "createdAt" to 1705326600000L,
                "participantIds" to listOf("owner-1", "user-2"),
                "hostIds" to listOf("user-2"),
                "requireApproval" to false,
                "voiceRoomName" to "voice-room-1",
            )

        val room = ChatRoom.fromMap(map, "room-1")

        assertEquals("room-1", room.roomId)
        assertEquals("Test Room", room.name)
        assertEquals("owner-1", room.ownerId)
        assertEquals(RoomState.ACTIVE, room.state)
        assertEquals(1705326600000L, room.createdAt)
        assertEquals(setOf("owner-1", "user-2"), room.participantIds)
        assertEquals(setOf("user-2"), room.hostIds)
        assertFalse(room.requireApproval)
        assertEquals("voice-room-1", room.voiceRoomName)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val room = ChatRoom.fromMap(emptyMap(), "room-2")

        assertEquals("room-2", room.roomId)
        assertEquals("", room.name)
        assertEquals("", room.ownerId)
        assertEquals(RoomState.ACTIVE, room.state)
        assertEquals(emptySet(), room.participantIds)
        assertEquals(emptySet(), room.hostIds)
        assertFalse(room.requireApproval)
        assertEquals(emptySet(), room.bannedUserIds)
        assertEquals(emptyMap(), room.kickInfo)
        assertEquals(emptyMap(), room.pendingInvites)
        assertEquals("", room.voiceRoomName)
        assertEquals(emptyMap(), room.firstJoinTimestamps)
        assertEquals(emptySet(), room.allTimeHostIds)
        assertEquals(emptySet(), room.allTimeSeatUserIds)
        assertNull(room.lastGiftEvent)
    }

    // ── State parsing ───────────────────────────────────────────────

    @Test
    fun `fromMap parses OWNER_AWAY state`() {
        val map = mapOf<String, Any?>("state" to "OWNER_AWAY")
        val room = ChatRoom.fromMap(map, "r1")
        assertEquals(RoomState.OWNER_AWAY, room.state)
    }

    @Test
    fun `fromMap parses CLOSED state`() {
        val map = mapOf<String, Any?>("state" to "CLOSED")
        val room = ChatRoom.fromMap(map, "r1")
        assertEquals(RoomState.CLOSED, room.state)
    }

    @Test
    fun `fromMap defaults to ACTIVE for unknown state`() {
        val map = mapOf<String, Any?>("state" to "UNKNOWN")
        val room = ChatRoom.fromMap(map, "r1")
        assertEquals(RoomState.ACTIVE, room.state)
    }

    @Test
    fun `fromMap defaults to ACTIVE for null state`() {
        val map = mapOf<String, Any?>("state" to null)
        val room = ChatRoom.fromMap(map, "r1")
        assertEquals(RoomState.ACTIVE, room.state)
    }

    // ── Optional timestamps ─────────────────────────────────────────

    @Test
    fun `fromMap parses ownerLeftAt`() {
        val map = mapOf<String, Any?>("ownerLeftAt" to 1705326600000L)
        val room = ChatRoom.fromMap(map, "r1")
        assertEquals(1705326600000L, room.ownerLeftAt)
    }

    @Test
    fun `fromMap handles null ownerLeftAt`() {
        val map = mapOf<String, Any?>("ownerLeftAt" to null)
        val room = ChatRoom.fromMap(map, "r1")
        assertNull(room.ownerLeftAt)
    }

    @Test
    fun `fromMap parses closedAt`() {
        val map = mapOf<String, Any?>("closedAt" to 1705326600000L)
        val room = ChatRoom.fromMap(map, "r1")
        assertEquals(1705326600000L, room.closedAt)
    }

    @Test
    fun `fromMap handles null closedAt`() {
        val map = mapOf<String, Any?>("closedAt" to null)
        val room = ChatRoom.fromMap(map, "r1")
        assertNull(room.closedAt)
    }

    // ── Seats parsing ───────────────────────────────────────────────

    @Test
    fun `fromMap creates MAX_SEATS seats`() {
        val room = ChatRoom.fromMap(emptyMap(), "r1")
        assertEquals(Constants.MAX_SEATS, room.seats.size)
    }

    @Test
    fun `fromMap parses seat data`() {
        val map =
            mapOf<String, Any?>(
                "seats" to
                    mapOf(
                        "0" to mapOf("userId" to "owner-1", "state" to "OCCUPIED", "isMuted" to false),
                        "1" to mapOf("userId" to "user-2", "state" to "OCCUPIED", "isMuted" to true),
                    ),
            )

        val room = ChatRoom.fromMap(map, "r1")

        assertEquals("owner-1", room.seats["0"]?.userId)
        assertEquals(SeatState.OCCUPIED, room.seats["0"]?.state)
        assertEquals("user-2", room.seats["1"]?.userId)
        assertTrue(room.seats["1"]?.isMuted == true)
    }

    @Test
    fun `fromMap fills missing seats with empty defaults`() {
        val map =
            mapOf<String, Any?>(
                "seats" to mapOf("0" to mapOf("userId" to "owner-1", "state" to "OCCUPIED")),
            )

        val room = ChatRoom.fromMap(map, "r1")

        // Seat 0 is occupied
        assertEquals("owner-1", room.seats["0"]?.userId)
        // Seats 1-7 should be empty
        for (i in 1 until Constants.MAX_SEATS) {
            assertNull(room.seats[i.toString()]?.userId)
            assertEquals(SeatState.EMPTY, room.seats[i.toString()]?.state)
        }
    }

    // ── kickInfo parsing ────────────────────────────────────────────

    @Test
    fun `fromMap parses kickInfo`() {
        val map =
            mapOf<String, Any?>(
                "kickInfo" to
                    mapOf(
                        "user-2" to mapOf("kickedBy" to "owner-1", "reason" to "Spam"),
                    ),
            )

        val room = ChatRoom.fromMap(map, "r1")

        assertEquals("owner-1", room.kickInfo["user-2"]?.get("kickedBy"))
        assertEquals("Spam", room.kickInfo["user-2"]?.get("reason"))
    }

    // ── pendingInvites parsing ──────────────────────────────────────

    @Test
    fun `fromMap parses pendingInvites`() {
        val map =
            mapOf<String, Any?>(
                "pendingInvites" to mapOf("user-3" to "owner-1"),
            )

        val room = ChatRoom.fromMap(map, "r1")

        assertEquals("owner-1", room.pendingInvites["user-3"])
    }

    // ── lastGiftEvent parsing ───────────────────────────────────────

    @Test
    fun `fromMap parses lastGiftEvent`() {
        val map =
            mapOf<String, Any?>(
                "lastGiftEvent" to
                    mapOf(
                        "senderId" to "s1",
                        "senderName" to "Alice",
                        "recipientId" to "r1",
                        "recipientName" to "Bob",
                        "giftId" to "g1",
                        "giftName" to "Rose",
                        "coinValue" to 100,
                        "timestamp" to 1705326600000L,
                    ),
            )

        val room = ChatRoom.fromMap(map, "r1")

        val event = room.lastGiftEvent
        assertNotNull(event)
        assertEquals("s1", event.senderId)
        assertEquals("Rose", event.giftName)
    }

    @Test
    fun `fromMap handles null lastGiftEvent`() {
        val map = mapOf<String, Any?>("lastGiftEvent" to null)
        val room = ChatRoom.fromMap(map, "r1")
        assertNull(room.lastGiftEvent)
    }

    // ── voiceRoomName fallback ──────────────────────────────────────

    @Test
    fun `fromMap uses agoraChannelName as fallback for voiceRoomName`() {
        val map = mapOf<String, Any?>("agoraChannelName" to "agora-channel-1")
        val room = ChatRoom.fromMap(map, "r1")
        assertEquals("agora-channel-1", room.voiceRoomName)
    }

    @Test
    fun `fromMap prefers voiceRoomName over agoraChannelName`() {
        val map =
            mapOf<String, Any?>(
                "voiceRoomName" to "voice-room-1",
                "agoraChannelName" to "agora-channel-1",
            )
        val room = ChatRoom.fromMap(map, "r1")
        assertEquals("voice-room-1", room.voiceRoomName)
    }

    // ── resolveRole ─────────────────────────────────────────────────

    @Test
    fun `resolveRole returns OWNER for ownerId`() {
        val room = ChatRoom(ownerId = "owner-1", hostIds = setOf("host-1"))
        assertEquals(RoomRole.OWNER, room.resolveRole("owner-1"))
    }

    @Test
    fun `resolveRole returns HOST for user in hostIds`() {
        val room = ChatRoom(ownerId = "owner-1", hostIds = setOf("host-1"))
        assertEquals(RoomRole.HOST, room.resolveRole("host-1"))
    }

    @Test
    fun `resolveRole returns ATTENDEE for regular user`() {
        val room = ChatRoom(ownerId = "owner-1", hostIds = setOf("host-1"))
        assertEquals(RoomRole.ATTENDEE, room.resolveRole("regular-user"))
    }

    @Test
    fun `resolveRole returns OWNER even if user is also in hostIds`() {
        val room = ChatRoom(ownerId = "owner-1", hostIds = setOf("owner-1"))
        assertEquals(RoomRole.OWNER, room.resolveRole("owner-1"))
    }

    // ── findUserSeat ────────────────────────────────────────────────

    @Test
    fun `findUserSeat returns seat entry for seated user`() {
        val seats =
            mapOf(
                "0" to Seat(userId = "owner-1", state = SeatState.OCCUPIED),
                "1" to Seat(userId = "user-2", state = SeatState.OCCUPIED),
                "2" to Seat(),
            )
        val room = ChatRoom(seats = seats)

        val entry = room.findUserSeat("user-2")
        assertNotNull(entry)
        assertEquals("1", entry.key)
        assertEquals("user-2", entry.value.userId)
    }

    @Test
    fun `findUserSeat returns null for unseated user`() {
        val room = ChatRoom()
        assertNull(room.findUserSeat("user-1"))
    }

    @Test
    fun `findUserSeat returns null for user in EMPTY state seat`() {
        val seats = mapOf("0" to Seat(userId = "user-1", state = SeatState.EMPTY))
        val room = ChatRoom(seats = seats)
        assertNull(room.findUserSeat("user-1"))
    }

    // ── hasSeatedNonOwners ──────────────────────────────────────────

    @Test
    fun `hasSeatedNonOwners returns false for empty room`() {
        val room = ChatRoom(ownerId = "owner-1")
        assertFalse(room.hasSeatedNonOwners())
    }

    @Test
    fun `hasSeatedNonOwners returns false when only owner is seated`() {
        val seats =
            mapOf(
                "0" to Seat(userId = "owner-1", state = SeatState.OCCUPIED),
                "1" to Seat(),
            )
        val room = ChatRoom(ownerId = "owner-1", seats = seats)
        assertFalse(room.hasSeatedNonOwners())
    }

    @Test
    fun `hasSeatedNonOwners returns true when non-owner is seated`() {
        val seats =
            mapOf(
                "0" to Seat(userId = "owner-1", state = SeatState.OCCUPIED),
                "1" to Seat(userId = "user-2", state = SeatState.OCCUPIED),
            )
        val room = ChatRoom(ownerId = "owner-1", seats = seats)
        assertTrue(room.hasSeatedNonOwners())
    }

    @Test
    fun `hasSeatedNonOwners ignores non-owner in EMPTY state`() {
        val seats =
            mapOf(
                "0" to Seat(userId = "owner-1", state = SeatState.OCCUPIED),
                "1" to Seat(userId = "user-2", state = SeatState.EMPTY),
            )
        val room = ChatRoom(ownerId = "owner-1", seats = seats)
        assertFalse(room.hasSeatedNonOwners())
    }

    // ── DEFAULT_SEATS ───────────────────────────────────────────────

    @Test
    fun `DEFAULT_SEATS has MAX_SEATS entries`() {
        assertEquals(Constants.MAX_SEATS, ChatRoom.DEFAULT_SEATS.size)
    }

    @Test
    fun `DEFAULT_SEATS are all empty`() {
        ChatRoom.DEFAULT_SEATS.values.forEach { seat ->
            assertNull(seat.userId)
            assertEquals(SeatState.EMPTY, seat.state)
            assertFalse(seat.isMuted)
        }
    }

    @Test
    fun `DEFAULT_SEATS keys are 0 through 7`() {
        val expectedKeys = (0 until Constants.MAX_SEATS).map { it.toString() }.toSet()
        assertEquals(expectedKeys, ChatRoom.DEFAULT_SEATS.keys)
    }

    // ── toMap ────────────────────────────────────────────────────────

    @Test
    fun `toMap includes all fields`() {
        val room =
            ChatRoom(
                roomId = "r1",
                name = "Room",
                ownerId = "owner-1",
                state = RoomState.ACTIVE,
                createdAt = 1705326600000L,
                requireApproval = true,
                voiceRoomName = "voice-1",
            )

        val map = room.toMap()

        assertEquals("r1", map["roomId"])
        assertEquals("Room", map["name"])
        assertEquals("owner-1", map["ownerId"])
        assertEquals("ACTIVE", map["state"])
        assertEquals(true, map["requireApproval"])
        assertEquals("voice-1", map["voiceRoomName"])
    }

    @Test
    fun `toMap serializes participantIds as list`() {
        val room = ChatRoom(participantIds = setOf("a", "b", "c"))
        val map = room.toMap()
        val ids = map["participantIds"] as List<*>
        assertEquals(3, ids.size)
        assertTrue("a" in ids)
        assertTrue("b" in ids)
        assertTrue("c" in ids)
    }

    // ── RoomState enum ──────────────────────────────────────────────

    @Test
    fun `RoomState has expected values`() {
        val states = RoomState.entries
        assertEquals(3, states.size)
        assertTrue(RoomState.ACTIVE in states)
        assertTrue(RoomState.OWNER_AWAY in states)
        assertTrue(RoomState.CLOSED in states)
    }

    // ── RoomRole enum ───────────────────────────────────────────────

    @Test
    fun `RoomRole has expected values`() {
        val roles = RoomRole.entries
        assertEquals(3, roles.size)
        assertTrue(RoomRole.OWNER in roles)
        assertTrue(RoomRole.HOST in roles)
        assertTrue(RoomRole.ATTENDEE in roles)
    }
}
