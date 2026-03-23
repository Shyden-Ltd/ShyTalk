package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Date

class ConversationSettingsFromMapTest {
    private val tsMillis = 1_000_000_000L
    private val ts = Timestamp(Date(tsMillis))

    @Test
    fun `fromMap parses complete valid map`() {
        val map =
            mapOf<String, Any?>(
                "isMuted" to true,
                "isHidden" to true,
                "hiddenAt" to ts,
                "isPinned" to true,
                "lastReadMessageId" to "msg-5",
                "lastReadAt" to ts,
                "unreadCount" to 3L,
            )
        val settings = ConversationSettings.fromMap(map, "user-1")

        assertEquals("user-1", settings.userId)
        assertTrue(settings.isMuted)
        assertTrue(settings.isHidden)
        assertEquals(tsMillis, settings.hiddenAt)
        assertTrue(settings.isPinned)
        assertEquals("msg-5", settings.lastReadMessageId)
        assertEquals(tsMillis, settings.lastReadAt)
        assertEquals(3L, settings.unreadCount)
    }

    @Test
    fun `fromMap handles empty map with defaults`() {
        val settings = ConversationSettings.fromMap(emptyMap(), "user-1")

        assertEquals("user-1", settings.userId)
        assertFalse(settings.isMuted)
        assertFalse(settings.isHidden)
        assertNull(settings.hiddenAt)
        assertFalse(settings.isPinned)
        assertEquals("", settings.lastReadMessageId)
        assertEquals(0L, settings.lastReadAt)
        assertEquals(0L, settings.unreadCount)
    }

    @Test
    fun `fromMap handles hiddenAt null`() {
        val map = mapOf<String, Any?>("hiddenAt" to null)
        val settings = ConversationSettings.fromMap(map, "user-1")
        assertNull(settings.hiddenAt)
    }

    @Test
    fun `fromMap handles lastReadAt null`() {
        val map = mapOf<String, Any?>("lastReadAt" to null)
        val settings = ConversationSettings.fromMap(map, "user-1")
        assertEquals(0L, settings.lastReadAt)
    }

    @Test
    fun `fromMap defaults unreadCount to 0 when missing`() {
        val settings = ConversationSettings.fromMap(emptyMap(), "user-1")
        assertEquals(0L, settings.unreadCount)
    }

    @Test
    fun `fromMap of toMap round-trip with hiddenAt`() {
        val original =
            ConversationSettings(
                userId = "user-1",
                isMuted = true,
                isHidden = true,
                hiddenAt = tsMillis,
                isPinned = false,
                lastReadMessageId = "msg-10",
                lastReadAt = tsMillis,
                unreadCount = 5,
            )
        val roundtripped = ConversationSettings.fromMap(original.toMap(), "user-1")
        assertEquals(original, roundtripped)
    }

    @Test
    fun `fromMap of toMap round-trip without hiddenAt`() {
        val original =
            ConversationSettings(
                userId = "user-1",
                isMuted = false,
                isHidden = false,
                hiddenAt = null,
                isPinned = true,
                lastReadMessageId = "",
                lastReadAt = 0,
                unreadCount = 0,
            )
        val roundtripped = ConversationSettings.fromMap(original.toMap(), "user-1")
        assertEquals(original, roundtripped)
    }
}
