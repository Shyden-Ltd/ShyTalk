package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class RoomRoleTest {
    @Test
    fun `enum has exactly three values`() {
        assertEquals(3, RoomRole.entries.size)
    }

    @Test
    fun `OWNER is a valid entry`() {
        assertTrue(RoomRole.OWNER in RoomRole.entries)
    }

    @Test
    fun `HOST is a valid entry`() {
        assertTrue(RoomRole.HOST in RoomRole.entries)
    }

    @Test
    fun `ATTENDEE is a valid entry`() {
        assertTrue(RoomRole.ATTENDEE in RoomRole.entries)
    }

    @Test
    fun `name returns expected strings`() {
        assertEquals("OWNER", RoomRole.OWNER.name)
        assertEquals("HOST", RoomRole.HOST.name)
        assertEquals("ATTENDEE", RoomRole.ATTENDEE.name)
    }

    @Test
    fun `ordinal preserves declaration order`() {
        assertEquals(0, RoomRole.OWNER.ordinal)
        assertEquals(1, RoomRole.HOST.ordinal)
        assertEquals(2, RoomRole.ATTENDEE.ordinal)
    }

    @Test
    fun `valueOf resolves known names`() {
        assertEquals(RoomRole.OWNER, RoomRole.valueOf("OWNER"))
        assertEquals(RoomRole.HOST, RoomRole.valueOf("HOST"))
        assertEquals(RoomRole.ATTENDEE, RoomRole.valueOf("ATTENDEE"))
    }

    @Test
    fun `valueOf throws for unknown name`() {
        var threw = false
        try {
            RoomRole.valueOf("MODERATOR")
        } catch (_: IllegalArgumentException) {
            threw = true
        }
        assertTrue(threw)
    }

    @Test
    fun `entries list is immutable snapshot`() {
        val first = RoomRole.entries
        val second = RoomRole.entries
        assertEquals(first, second)
    }

    @Test
    fun `OWNER is not equal to HOST`() {
        assertFalse(RoomRole.OWNER == RoomRole.HOST)
    }
}
