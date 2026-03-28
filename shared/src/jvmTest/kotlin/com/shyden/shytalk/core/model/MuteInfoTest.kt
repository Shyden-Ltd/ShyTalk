package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class MuteInfoTest {
    // ── fromMap ─────────────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "mutedBy" to "mod-1",
                "mutedByName" to "Moderator",
                "reason" to "Spam",
                "mutedAt" to 1705326600000L,
                "expiresAt" to 1705413000000L,
                "isActive" to true,
            )

        val info = MuteInfo.fromMap(map, "user-1")

        assertEquals("user-1", info.mutedUserId)
        assertEquals("mod-1", info.mutedBy)
        assertEquals("Moderator", info.mutedByName)
        assertEquals("Spam", info.reason)
        assertEquals(1705326600000L, info.mutedAt)
        assertEquals(1705413000000L, info.expiresAt)
        assertTrue(info.isActive)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val info = MuteInfo.fromMap(emptyMap(), "user-2")

        assertEquals("user-2", info.mutedUserId)
        assertEquals("", info.mutedBy)
        assertEquals("", info.mutedByName)
        assertNull(info.reason)
        assertEquals(0L, info.mutedAt)
        assertNull(info.expiresAt)
        assertTrue(info.isActive) // default true
    }

    @Test
    fun `fromMap handles null reason`() {
        val map = mapOf<String, Any?>("reason" to null)
        val info = MuteInfo.fromMap(map, "u1")
        assertNull(info.reason)
    }

    @Test
    fun `fromMap handles null expiresAt`() {
        val map = mapOf<String, Any?>("expiresAt" to null)
        val info = MuteInfo.fromMap(map, "u1")
        assertNull(info.expiresAt)
    }

    @Test
    fun `fromMap handles isActive as integer boolean`() {
        val map = mapOf<String, Any?>("isActive" to 0)
        val info = MuteInfo.fromMap(map, "u1")
        assertEquals(false, info.isActive)
    }

    @Test
    fun `fromMap handles isActive as integer boolean 1`() {
        val map = mapOf<String, Any?>("isActive" to 1)
        val info = MuteInfo.fromMap(map, "u1")
        assertTrue(info.isActive)
    }

    // ── toMap ────────────────────────────────────────────────────────

    @Test
    fun `toMap includes all fields`() {
        val info =
            MuteInfo(
                mutedUserId = "user-1",
                mutedBy = "mod-1",
                mutedByName = "Mod",
                reason = "Bad behavior",
                mutedAt = 1705326600000L,
                expiresAt = 1705413000000L,
                isActive = true,
            )

        val map = info.toMap()

        assertEquals("mod-1", map["mutedBy"])
        assertEquals("Mod", map["mutedByName"])
        assertEquals("Bad behavior", map["reason"])
        assertEquals(1705326600000L, map["mutedAt"])
        assertEquals(1705413000000L, map["expiresAt"])
        assertEquals(true, map["isActive"])
    }

    @Test
    fun `toMap does not include mutedUserId`() {
        val info = MuteInfo(mutedUserId = "u1")
        val map = info.toMap()
        assertTrue("mutedUserId" !in map)
    }

    // ── roundtrip ───────────────────────────────────────────────────

    @Test
    fun `toMap and fromMap roundtrip preserves data`() {
        val original =
            MuteInfo(
                mutedUserId = "user-rt",
                mutedBy = "mod-1",
                mutedByName = "Moderator",
                reason = "Testing",
                mutedAt = 1705326600000L,
                expiresAt = 1705413000000L,
                isActive = false,
            )

        val map = original.toMap()
        val restored = MuteInfo.fromMap(map, original.mutedUserId)

        assertEquals(original, restored)
    }

    @Test
    fun `roundtrip with null optional fields`() {
        val original =
            MuteInfo(
                mutedUserId = "u1",
                mutedBy = "mod-1",
                mutedByName = "Mod",
                reason = null,
                expiresAt = null,
            )

        val map = original.toMap()
        val restored = MuteInfo.fromMap(map, original.mutedUserId)

        assertEquals(original.reason, restored.reason)
        assertEquals(original.expiresAt, restored.expiresAt)
    }
}
