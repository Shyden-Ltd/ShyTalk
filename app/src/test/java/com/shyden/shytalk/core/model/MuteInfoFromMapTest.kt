package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class MuteInfoFromMapTest {
    @Test
    fun `default values`() {
        val mute = MuteInfo()
        assertEquals("", mute.mutedUserId)
        assertEquals("", mute.mutedBy)
        assertEquals("", mute.mutedByName)
        assertNull(mute.reason)
        assertEquals(0L, mute.mutedAt)
        assertNull(mute.expiresAt)
        assertTrue(mute.isActive)
    }

    @Test
    fun `fromMap parses complete valid map`() {
        val map =
            mapOf<String, Any?>(
                "mutedBy" to "admin-1",
                "mutedByName" to "Admin Alice",
                "reason" to "Spamming",
                "mutedAt" to 1_000_000_000L,
                "expiresAt" to 2_000_000_000L,
                "isActive" to true,
            )
        val mute = MuteInfo.fromMap(map, "user-42")

        assertEquals("user-42", mute.mutedUserId)
        assertEquals("admin-1", mute.mutedBy)
        assertEquals("Admin Alice", mute.mutedByName)
        assertEquals("Spamming", mute.reason)
        assertEquals(1_000_000_000L, mute.mutedAt)
        assertEquals(2_000_000_000L, mute.expiresAt)
        assertTrue(mute.isActive)
    }

    @Test
    fun `fromMap handles empty map with defaults`() {
        val mute = MuteInfo.fromMap(emptyMap(), "user-1")

        assertEquals("user-1", mute.mutedUserId)
        assertEquals("", mute.mutedBy)
        assertEquals("", mute.mutedByName)
        assertNull(mute.reason)
        assertEquals(0L, mute.mutedAt)
        assertNull(mute.expiresAt)
        assertTrue(mute.isActive)
    }

    @Test
    fun `fromMap handles null values`() {
        val map =
            mapOf<String, Any?>(
                "mutedBy" to null,
                "mutedByName" to null,
                "reason" to null,
                "mutedAt" to null,
                "expiresAt" to null,
                "isActive" to null,
            )
        val mute = MuteInfo.fromMap(map, "user-1")

        assertEquals("", mute.mutedBy)
        assertEquals("", mute.mutedByName)
        assertNull(mute.reason)
        assertEquals(0L, mute.mutedAt)
        assertNull(mute.expiresAt)
        assertTrue(mute.isActive)
    }

    @Test
    fun `fromMap handles permanent mute with null expiresAt`() {
        val map =
            mapOf<String, Any?>(
                "mutedBy" to "mod-1",
                "mutedByName" to "Moderator",
                "reason" to "Repeated violations",
                "mutedAt" to 1_000_000_000L,
                "expiresAt" to null,
                "isActive" to true,
            )
        val mute = MuteInfo.fromMap(map, "user-bad")

        assertNull(mute.expiresAt)
        assertTrue(mute.isActive)
    }

    @Test
    fun `fromMap handles inactive mute`() {
        val map =
            mapOf<String, Any?>(
                "isActive" to false,
            )
        val mute = MuteInfo.fromMap(map, "user-1")
        assertEquals(false, mute.isActive)
    }

    @Test
    fun `toMap does not include mutedUserId`() {
        val mute = MuteInfo(mutedUserId = "user-42", mutedBy = "admin-1")
        val map = mute.toMap()
        assertNull(map["mutedUserId"])
        assertEquals("admin-1", map["mutedBy"])
    }

    @Test
    fun `toMap includes all non-mutedUserId fields`() {
        val mute =
            MuteInfo(
                mutedUserId = "user-42",
                mutedBy = "admin-1",
                mutedByName = "Admin",
                reason = "Spam",
                mutedAt = 1_000_000_000L,
                expiresAt = 2_000_000_000L,
                isActive = true,
            )
        val map = mute.toMap()
        assertEquals("admin-1", map["mutedBy"])
        assertEquals("Admin", map["mutedByName"])
        assertEquals("Spam", map["reason"])
        assertEquals(1_000_000_000L, map["mutedAt"])
        assertEquals(2_000_000_000L, map["expiresAt"])
        assertEquals(true, map["isActive"])
    }

    @Test
    fun `fromMap of toMap round-trip preserves data except mutedUserId`() {
        val original =
            MuteInfo(
                mutedUserId = "user-42",
                mutedBy = "admin-1",
                mutedByName = "Admin Alice",
                reason = "Spam",
                mutedAt = 1_000_000_000L,
                expiresAt = 2_000_000_000L,
                isActive = true,
            )
        val roundtripped = MuteInfo.fromMap(original.toMap(), "user-42")
        assertEquals(original, roundtripped)
    }

    @Test
    fun `fromMap of toMap round-trip with null reason and expiresAt`() {
        val original =
            MuteInfo(
                mutedUserId = "user-1",
                mutedBy = "mod-1",
                mutedByName = "Mod",
                reason = null,
                mutedAt = 1_000_000_000L,
                expiresAt = null,
                isActive = true,
            )
        val roundtripped = MuteInfo.fromMap(original.toMap(), "user-1")
        assertEquals(original, roundtripped)
    }
}
