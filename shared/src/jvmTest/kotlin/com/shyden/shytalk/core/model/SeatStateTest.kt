package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SeatStateTest {
    @Test
    fun `enum has exactly two values`() {
        assertEquals(2, SeatState.entries.size)
    }

    @Test
    fun `EMPTY is a valid entry`() {
        assertTrue(SeatState.EMPTY in SeatState.entries)
    }

    @Test
    fun `OCCUPIED is a valid entry`() {
        assertTrue(SeatState.OCCUPIED in SeatState.entries)
    }

    @Test
    fun `name returns expected strings`() {
        assertEquals("EMPTY", SeatState.EMPTY.name)
        assertEquals("OCCUPIED", SeatState.OCCUPIED.name)
    }

    @Test
    fun `ordinal preserves declaration order`() {
        assertEquals(0, SeatState.EMPTY.ordinal)
        assertEquals(1, SeatState.OCCUPIED.ordinal)
    }

    @Test
    fun `valueOf resolves known names`() {
        assertEquals(SeatState.EMPTY, SeatState.valueOf("EMPTY"))
        assertEquals(SeatState.OCCUPIED, SeatState.valueOf("OCCUPIED"))
    }

    @Test
    fun `valueOf throws for unknown name`() {
        var threw = false
        try {
            SeatState.valueOf("LOCKED")
        } catch (_: IllegalArgumentException) {
            threw = true
        }
        assertTrue(threw)
    }

    @Test
    fun `EMPTY is not equal to OCCUPIED`() {
        assertFalse(SeatState.EMPTY == SeatState.OCCUPIED)
    }

    @Test
    fun `entries list is immutable snapshot`() {
        val first = SeatState.entries
        val second = SeatState.entries
        assertEquals(first, second)
    }
}
