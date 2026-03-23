package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class ChatRoomTest {
    private val baseTimestamp = 1_000_000_000L

    @Test
    fun `kickInfo round-trips through toMap and fromMap`() {
        val room =
            ChatRoom(
                roomId = "room-1",
                name = "Test",
                ownerId = "owner",
                createdAt = baseTimestamp,
                kickInfo =
                    mapOf(
                        "user-1" to mapOf("kickerName" to "Admin", "reason" to "Spamming"),
                        "user-2" to mapOf("kickerName" to "Mod", "reason" to "No reason given"),
                    ),
            )

        val map = room.toMap()
        val restored = ChatRoom.fromMap(map, "room-1")

        assertEquals(2, restored.kickInfo.size)
        assertEquals("Admin", restored.kickInfo["user-1"]?.get("kickerName"))
        assertEquals("Spamming", restored.kickInfo["user-1"]?.get("reason"))
        assertEquals("Mod", restored.kickInfo["user-2"]?.get("kickerName"))
        assertEquals("No reason given", restored.kickInfo["user-2"]?.get("reason"))
    }

    @Test
    fun `missing kickInfo in map defaults to empty`() {
        val map =
            mapOf<String, Any?>(
                "roomId" to "room-1",
                "name" to "Test",
                "ownerId" to "owner",
                "createdAt" to baseTimestamp,
            )

        val room = ChatRoom.fromMap(map, "room-1")

        assertTrue(room.kickInfo.isEmpty())
    }

    @Test
    fun `bannedUserIds round-trips correctly`() {
        val room =
            ChatRoom(
                roomId = "room-1",
                ownerId = "owner",
                bannedUserIds = setOf("banned-1", "banned-2"),
                createdAt = baseTimestamp,
            )

        val map = room.toMap()
        val restored = ChatRoom.fromMap(map, "room-1")

        assertEquals(setOf("banned-1", "banned-2"), restored.bannedUserIds)
    }

    // --- findUserSeat ---

    @Test
    fun `findUserSeat returns correct entry for seated user`() {
        val seats = ChatRoom.DEFAULT_SEATS.toMutableMap()
        seats["2"] = Seat(userId = "user-A", state = SeatState.OCCUPIED)
        val room =
            ChatRoom(
                roomId = "room-1",
                ownerId = "owner",
                seats = seats,
                createdAt = baseTimestamp,
            )

        val entry = room.findUserSeat("user-A")

        assertNotNull(entry)
        assertEquals("2", entry!!.key)
        assertEquals("user-A", entry.value.userId)
        assertEquals(SeatState.OCCUPIED, entry.value.state)
    }

    @Test
    fun `findUserSeat returns null for unseated user`() {
        val room =
            ChatRoom(
                roomId = "room-1",
                ownerId = "owner",
                createdAt = baseTimestamp,
            )

        assertNull(room.findUserSeat("user-A"))
    }

    @Test
    fun `findUserSeat returns null for empty room`() {
        val room =
            ChatRoom(
                roomId = "room-1",
                ownerId = "owner",
                seats = ChatRoom.DEFAULT_SEATS,
                createdAt = baseTimestamp,
            )

        assertNull(room.findUserSeat("anyone"))
    }

    @Test
    fun `findUserSeat ignores non-OCCUPIED seats with matching userId`() {
        val seats = ChatRoom.DEFAULT_SEATS.toMutableMap()
        seats["3"] = Seat(userId = "user-B", state = SeatState.EMPTY)
        val room =
            ChatRoom(
                roomId = "room-1",
                ownerId = "owner",
                seats = seats,
                createdAt = baseTimestamp,
            )

        assertNull(room.findUserSeat("user-B"))
    }

    // --- First empty seat finding (used by request seat feature) ---

    @Test
    fun `first empty seat found when some seats occupied`() {
        val seats = ChatRoom.DEFAULT_SEATS.toMutableMap()
        seats["0"] = Seat(userId = "owner", state = SeatState.OCCUPIED)
        seats["1"] = Seat(userId = "user-1", state = SeatState.OCCUPIED)
        // seat 2 is empty (from DEFAULT_SEATS)
        val room = ChatRoom(roomId = "room-1", ownerId = "owner", seats = seats, createdAt = baseTimestamp)

        val firstEmpty =
            room.seats.entries
                .filter { it.value.state == SeatState.EMPTY }
                .minByOrNull { it.key.toIntOrNull() ?: Int.MAX_VALUE }

        assertNotNull(firstEmpty)
        assertEquals("2", firstEmpty!!.key)
    }

    @Test
    fun `no empty seat when all seats occupied`() {
        val seats =
            (0 until 8).associate {
                it.toString() to Seat(userId = "user-$it", state = SeatState.OCCUPIED)
            }
        val room = ChatRoom(roomId = "room-1", ownerId = "owner", seats = seats, createdAt = baseTimestamp)

        val firstEmpty =
            room.seats.entries
                .filter { it.value.state == SeatState.EMPTY }
                .minByOrNull { it.key.toIntOrNull() ?: Int.MAX_VALUE }

        assertNull(firstEmpty)
    }

    // --- showRequestSeat condition logic ---

    @Test
    fun `showRequestSeat true when user not seated and seating unlocked`() {
        val seats = ChatRoom.DEFAULT_SEATS.toMutableMap()
        seats["0"] = Seat(userId = "owner", state = SeatState.OCCUPIED)
        val room =
            ChatRoom(
                roomId = "room-1",
                ownerId = "owner",
                seats = seats,
                requireApproval = false,
                createdAt = baseTimestamp,
            )
        val currentUserId = "attendee-1"

        val isSeated = room.seats.values.any { it.isOccupiedBy(currentUserId) }
        val showRequestSeat = !isSeated && !room.requireApproval

        assertTrue(showRequestSeat)
    }

    @Test
    fun `showRequestSeat false when user is seated`() {
        val seats = ChatRoom.DEFAULT_SEATS.toMutableMap()
        seats["0"] = Seat(userId = "owner", state = SeatState.OCCUPIED)
        seats["3"] = Seat(userId = "attendee-1", state = SeatState.OCCUPIED)
        val room =
            ChatRoom(
                roomId = "room-1",
                ownerId = "owner",
                seats = seats,
                requireApproval = false,
                createdAt = baseTimestamp,
            )
        val currentUserId = "attendee-1"

        val isSeated = room.seats.values.any { it.isOccupiedBy(currentUserId) }
        val showRequestSeat = !isSeated && !room.requireApproval

        assertEquals(false, showRequestSeat)
    }

    @Test
    fun `showRequestSeat false when seating is locked`() {
        val seats = ChatRoom.DEFAULT_SEATS.toMutableMap()
        seats["0"] = Seat(userId = "owner", state = SeatState.OCCUPIED)
        val room =
            ChatRoom(
                roomId = "room-1",
                ownerId = "owner",
                seats = seats,
                requireApproval = true,
                createdAt = baseTimestamp,
            )
        val currentUserId = "attendee-1"

        val isSeated = room.seats.values.any { it.isOccupiedBy(currentUserId) }
        val showRequestSeat = !isSeated && !room.requireApproval

        assertEquals(false, showRequestSeat)
    }
}
