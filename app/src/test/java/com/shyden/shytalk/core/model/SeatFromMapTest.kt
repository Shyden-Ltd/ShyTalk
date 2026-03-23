package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SeatFromMapTest {
    @Test
    fun `fromMap parses complete valid map`() {
        val map =
            mapOf<String, Any?>(
                "userId" to "user-1",
                "state" to "OCCUPIED",
                "isMuted" to true,
            )
        val seat = Seat.fromMap(map)
        assertEquals("user-1", seat.userId)
        assertEquals(SeatState.OCCUPIED, seat.state)
        assertEquals(true, seat.isMuted)
    }

    @Test
    fun `fromMap defaults userId to null when missing`() {
        val seat = Seat.fromMap(emptyMap())
        assertNull(seat.userId)
    }

    @Test
    fun `fromMap defaults state to EMPTY for invalid value`() {
        val map = mapOf<String, Any?>("state" to "INVALID")
        val seat = Seat.fromMap(map)
        assertEquals(SeatState.EMPTY, seat.state)
    }

    @Test
    fun `fromMap defaults state to EMPTY when missing`() {
        val seat = Seat.fromMap(emptyMap())
        assertEquals(SeatState.EMPTY, seat.state)
    }

    @Test
    fun `fromMap defaults isMuted to false when missing`() {
        val seat = Seat.fromMap(emptyMap())
        assertFalse(seat.isMuted)
    }

    @Test
    fun `fromMap handles empty map with all defaults`() {
        val seat = Seat.fromMap(emptyMap())
        assertNull(seat.userId)
        assertEquals(SeatState.EMPTY, seat.state)
        assertFalse(seat.isMuted)
    }

    @Test
    fun `toMap produces correct map`() {
        val seat = Seat(userId = "user-1", state = SeatState.OCCUPIED, isMuted = true)
        val map = seat.toMap()
        assertEquals("user-1", map["userId"])
        assertEquals("OCCUPIED", map["state"])
        assertEquals(true, map["isMuted"])
    }

    // --- isOccupiedBy ---

    @Test
    fun `isOccupiedBy returns true when matching userId and OCCUPIED state`() {
        val seat = Seat(userId = "user-1", state = SeatState.OCCUPIED)
        assertTrue(seat.isOccupiedBy("user-1"))
    }

    @Test
    fun `isOccupiedBy returns false for different userId`() {
        val seat = Seat(userId = "user-1", state = SeatState.OCCUPIED)
        assertFalse(seat.isOccupiedBy("user-2"))
    }

    @Test
    fun `isOccupiedBy returns false for EMPTY state`() {
        val seat = Seat(userId = "user-1", state = SeatState.EMPTY)
        assertFalse(seat.isOccupiedBy("user-1"))
    }

    @Test
    fun `isOccupiedBy returns false for null userId`() {
        val seat = Seat(userId = null, state = SeatState.OCCUPIED)
        assertFalse(seat.isOccupiedBy("user-1"))
    }

    @Test
    fun `isOccupiedBy returns false for empty seat`() {
        val seat = Seat()
        assertFalse(seat.isOccupiedBy("user-1"))
    }

    // --- EMPTY_MAP cache ---

    @Test
    fun `EMPTY_MAP matches default Seat toMap`() {
        assertEquals(Seat().toMap(), Seat.EMPTY_MAP)
    }

    @Test
    fun `EMPTY_MAP is same reference on repeated access`() {
        val first = Seat.EMPTY_MAP
        val second = Seat.EMPTY_MAP
        assertTrue(first === second)
    }

    @Test
    fun `EMPTY_MAP contains correct default values`() {
        assertNull(Seat.EMPTY_MAP["userId"])
        assertEquals("EMPTY", Seat.EMPTY_MAP["state"])
        assertEquals(false, Seat.EMPTY_MAP["isMuted"])
    }
}
