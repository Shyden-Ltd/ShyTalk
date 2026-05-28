package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SeatTest {
    // ── fromMap ─────────────────────────────────────────────────────

    @Test
    fun `fromMap parses occupied seat`() {
        val map =
            mapOf<String, Any?>(
                "userId" to "user-1",
                "state" to "OCCUPIED",
                "isMuted" to true,
            )

        val seat = Seat.fromMap(map)

        assertEquals("user-1", seat.userId)
        assertEquals(SeatState.OCCUPIED, seat.state)
        assertTrue(seat.isMuted)
    }

    @Test
    fun `fromMap parses empty seat`() {
        val map =
            mapOf<String, Any?>(
                "userId" to null,
                "state" to "EMPTY",
                "isMuted" to false,
            )

        val seat = Seat.fromMap(map)

        assertNull(seat.userId)
        assertEquals(SeatState.EMPTY, seat.state)
        assertFalse(seat.isMuted)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val seat = Seat.fromMap(emptyMap())

        assertNull(seat.userId)
        assertEquals(SeatState.EMPTY, seat.state)
        assertFalse(seat.isMuted)
    }

    @Test
    fun `fromMap defaults to EMPTY for unknown state`() {
        val map = mapOf<String, Any?>("state" to "INVALID_STATE")
        val seat = Seat.fromMap(map)
        assertEquals(SeatState.EMPTY, seat.state)
    }

    @Test
    fun `fromMap defaults to EMPTY for null state`() {
        val map = mapOf<String, Any?>("state" to null)
        val seat = Seat.fromMap(map)
        assertEquals(SeatState.EMPTY, seat.state)
    }

    @Test
    fun `fromMap handles isMuted as integer boolean`() {
        val map = mapOf<String, Any?>("isMuted" to 1)
        val seat = Seat.fromMap(map)
        assertTrue(seat.isMuted)
    }

    // ── toMap ────────────────────────────────────────────────────────

    @Test
    fun `toMap includes all fields`() {
        val seat = Seat(userId = "user-1", state = SeatState.OCCUPIED, isMuted = true)
        val map = seat.toMap()

        assertEquals("user-1", map["userId"])
        assertEquals("OCCUPIED", map["state"])
        assertEquals(true, map["isMuted"])
    }

    @Test
    fun `toMap empty seat has null userId`() {
        val seat = Seat()
        val map = seat.toMap()

        assertNull(map["userId"])
        assertEquals("EMPTY", map["state"])
        assertEquals(false, map["isMuted"])
    }

    // ── roundtrip ───────────────────────────────────────────────────

    @Test
    fun `toMap and fromMap roundtrip occupied seat`() {
        val original = Seat(userId = "user-1", state = SeatState.OCCUPIED, isMuted = true)
        val restored = Seat.fromMap(original.toMap())
        assertEquals(original, restored)
    }

    @Test
    fun `toMap and fromMap roundtrip empty seat`() {
        val original = Seat()
        val restored = Seat.fromMap(original.toMap())
        assertEquals(original, restored)
    }

    // ── isOccupiedBy ─────────────────────────────────────────────────

    @Test
    fun `isOccupiedBy returns true for matching user in OCCUPIED state`() {
        val seat = Seat(userId = "user-1", state = SeatState.OCCUPIED)
        assertTrue(seat.isOccupiedBy("user-1"))
    }

    @Test
    fun `isOccupiedBy returns false for different user`() {
        val seat = Seat(userId = "user-1", state = SeatState.OCCUPIED)
        assertFalse(seat.isOccupiedBy("user-2"))
    }

    @Test
    fun `isOccupiedBy returns false for matching user in EMPTY state`() {
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

    // ── EMPTY_MAP ───────────────────────────────────────────────────

    @Test
    fun `EMPTY_MAP matches default Seat toMap`() {
        assertEquals(Seat().toMap(), Seat.EMPTY_MAP)
    }

    @Test
    fun `EMPTY_MAP has null userId`() {
        assertNull(Seat.EMPTY_MAP["userId"])
    }

    @Test
    fun `EMPTY_MAP has EMPTY state`() {
        assertEquals("EMPTY", Seat.EMPTY_MAP["state"])
    }

    @Test
    fun `EMPTY_MAP has false isMuted`() {
        assertEquals(false, Seat.EMPTY_MAP["isMuted"])
    }

    // ── SeatState enum ──────────────────────────────────────────────

    @Test
    fun `SeatState has EMPTY and OCCUPIED`() {
        val states = SeatState.entries
        assertEquals(2, states.size)
        assertTrue(SeatState.EMPTY in states)
        assertTrue(SeatState.OCCUPIED in states)
    }

    // ── Default constructor ─────────────────────────────────────────

    @Test
    fun `default constructor creates empty seat`() {
        val seat = Seat()
        assertNull(seat.userId)
        assertEquals(SeatState.EMPTY, seat.state)
        assertFalse(seat.isMuted)
    }
}
