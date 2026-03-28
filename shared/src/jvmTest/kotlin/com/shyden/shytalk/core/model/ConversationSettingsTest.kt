package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ConversationSettingsTest {
    // ── fromMap ─────────────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "isMuted" to true,
                "isHidden" to true,
                "hiddenAt" to 1705326600000L,
                "isPinned" to true,
                "lastReadMessageId" to "msg-100",
                "lastReadAt" to 1705326700000L,
                "unreadCount" to 5L,
            )

        val settings = ConversationSettings.fromMap(map, "user-1")

        assertEquals("user-1", settings.userId)
        assertTrue(settings.isMuted)
        assertTrue(settings.isHidden)
        assertEquals(1705326600000L, settings.hiddenAt)
        assertTrue(settings.isPinned)
        assertEquals("msg-100", settings.lastReadMessageId)
        assertEquals(1705326700000L, settings.lastReadAt)
        assertEquals(5L, settings.unreadCount)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val settings = ConversationSettings.fromMap(emptyMap(), "user-2")

        assertEquals("user-2", settings.userId)
        assertFalse(settings.isMuted)
        assertFalse(settings.isHidden)
        assertNull(settings.hiddenAt)
        assertFalse(settings.isPinned)
        assertEquals("", settings.lastReadMessageId)
        assertEquals(0L, settings.lastReadAt)
        assertEquals(0L, settings.unreadCount)
    }

    @Test
    fun `fromMap handles integer booleans`() {
        val map =
            mapOf<String, Any?>(
                "isMuted" to 1,
                "isHidden" to 0,
                "isPinned" to 1,
            )

        val settings = ConversationSettings.fromMap(map, "u1")

        assertTrue(settings.isMuted)
        assertFalse(settings.isHidden)
        assertTrue(settings.isPinned)
    }

    @Test
    fun `fromMap handles null hiddenAt`() {
        val map = mapOf<String, Any?>("hiddenAt" to null)
        val settings = ConversationSettings.fromMap(map, "u1")
        assertNull(settings.hiddenAt)
    }

    // ── toMap ────────────────────────────────────────────────────────

    @Test
    fun `toMap includes all fields`() {
        val settings =
            ConversationSettings(
                userId = "u1",
                isMuted = true,
                isHidden = false,
                hiddenAt = 1705326600000L,
                isPinned = true,
                lastReadMessageId = "msg-50",
                lastReadAt = 1705326700000L,
                unreadCount = 3,
            )

        val map = settings.toMap()

        assertEquals("u1", map["userId"])
        assertEquals(true, map["isMuted"])
        assertEquals(false, map["isHidden"])
        assertEquals(1705326600000L, map["hiddenAt"])
        assertEquals(true, map["isPinned"])
        assertEquals("msg-50", map["lastReadMessageId"])
        assertEquals(1705326700000L, map["lastReadAt"])
        assertEquals(3L, map["unreadCount"])
    }

    // ── roundtrip ───────────────────────────────────────────────────

    @Test
    fun `toMap and fromMap roundtrip preserves data`() {
        val original =
            ConversationSettings(
                userId = "u-rt",
                isMuted = true,
                isHidden = true,
                hiddenAt = 1705326600000L,
                isPinned = false,
                lastReadMessageId = "msg-99",
                lastReadAt = 1705326700000L,
                unreadCount = 10,
            )

        val map = original.toMap()
        val restored = ConversationSettings.fromMap(map, original.userId)

        assertEquals(original, restored)
    }

    @Test
    fun `roundtrip with null hiddenAt`() {
        val original =
            ConversationSettings(
                userId = "u-null",
                hiddenAt = null,
            )

        val map = original.toMap()
        val restored = ConversationSettings.fromMap(map, original.userId)

        assertEquals(original.hiddenAt, restored.hiddenAt)
    }

    // ── default factory ─────────────────────────────────────────────

    @Test
    fun `default factory creates settings with userId`() {
        val settings = ConversationSettings.default("user-1")
        assertEquals("user-1", settings.userId)
        assertFalse(settings.isMuted)
        assertFalse(settings.isHidden)
        assertNull(settings.hiddenAt)
        assertFalse(settings.isPinned)
        assertEquals("", settings.lastReadMessageId)
        assertEquals(0L, settings.lastReadAt)
        assertEquals(0L, settings.unreadCount)
    }
}
