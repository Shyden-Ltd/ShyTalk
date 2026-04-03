package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RoomStateTest {
    @Test
    fun `enum has exactly three values`() {
        assertEquals(3, RoomState.entries.size)
    }

    @Test
    fun `ACTIVE is a valid entry`() {
        assertTrue(RoomState.ACTIVE in RoomState.entries)
    }

    @Test
    fun `OWNER_AWAY is a valid entry`() {
        assertTrue(RoomState.OWNER_AWAY in RoomState.entries)
    }

    @Test
    fun `CLOSED is a valid entry`() {
        assertTrue(RoomState.CLOSED in RoomState.entries)
    }

    @Test
    fun `name returns expected strings`() {
        assertEquals("ACTIVE", RoomState.ACTIVE.name)
        assertEquals("OWNER_AWAY", RoomState.OWNER_AWAY.name)
        assertEquals("CLOSED", RoomState.CLOSED.name)
    }

    @Test
    fun `ordinal preserves declaration order`() {
        assertEquals(0, RoomState.ACTIVE.ordinal)
        assertEquals(1, RoomState.OWNER_AWAY.ordinal)
        assertEquals(2, RoomState.CLOSED.ordinal)
    }

    @Test
    fun `valueOf resolves known names`() {
        assertEquals(RoomState.ACTIVE, RoomState.valueOf("ACTIVE"))
        assertEquals(RoomState.OWNER_AWAY, RoomState.valueOf("OWNER_AWAY"))
        assertEquals(RoomState.CLOSED, RoomState.valueOf("CLOSED"))
    }

    @Test
    fun `valueOf throws for unknown name`() {
        var threw = false
        try {
            RoomState.valueOf("PAUSED")
        } catch (_: IllegalArgumentException) {
            threw = true
        }
        assertTrue(threw)
    }

    @Test
    fun `ACTIVE is not equal to CLOSED`() {
        assertFalse(RoomState.ACTIVE == RoomState.CLOSED)
    }

    @Test
    fun `entries list is immutable snapshot`() {
        val first = RoomState.entries
        val second = RoomState.entries
        assertEquals(first, second)
    }
}
