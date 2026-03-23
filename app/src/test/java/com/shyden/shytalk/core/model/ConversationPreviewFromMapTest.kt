package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Date

class ConversationPreviewFromMapTest {
    private val tsMillis = 1_000_000_000L
    private val ts = Timestamp(Date(tsMillis))

    @Test
    fun `fromMap parses complete valid map`() {
        val map =
            mapOf<String, Any?>(
                "text" to "Hello!",
                "senderId" to "user-1",
                "senderName" to "Alice",
                "createdAt" to ts,
                "type" to "IMAGE",
            )
        val preview = ConversationPreview.fromMap(map)

        assertEquals("Hello!", preview.text)
        assertEquals("user-1", preview.senderId)
        assertEquals("Alice", preview.senderName)
        assertEquals(tsMillis, preview.createdAt)
        assertEquals("IMAGE", preview.type)
    }

    @Test
    fun `fromMap handles empty map with defaults`() {
        val preview = ConversationPreview.fromMap(emptyMap())

        assertEquals("", preview.text)
        assertEquals("", preview.senderId)
        assertEquals("", preview.senderName)
        assertEquals("TEXT", preview.type)
    }

    @Test
    fun `fromMap of toMap round-trip`() {
        val original =
            ConversationPreview(
                text = "Last message",
                senderId = "user-1",
                senderName = "Alice",
                createdAt = tsMillis,
                type = "IMAGE",
            )
        val roundtripped = ConversationPreview.fromMap(original.toMap())
        assertEquals(original, roundtripped)
    }

    @Test
    fun `fromMap defaults type to TEXT when null`() {
        val map = mapOf<String, Any?>("type" to null)
        val preview = ConversationPreview.fromMap(map)
        assertEquals("TEXT", preview.type)
    }

    @Test
    fun `fromMap parses Express API format with createdAt (not timestamp)`() {
        // Express API sends: { text, senderId, senderName, type, createdAt }
        val expressApiFormat =
            mapOf<String, Any?>(
                "text" to "Hello",
                "senderId" to "user-1",
                "senderName" to "Alice",
                "type" to "TEXT",
                "createdAt" to tsMillis,
            )
        val preview = ConversationPreview.fromMap(expressApiFormat)
        assertEquals(tsMillis, preview.createdAt)
    }

    @Test
    fun `fromMap ignores old timestamp field (only reads createdAt)`() {
        // Verify that the old "timestamp" field does NOT populate createdAt
        // When "createdAt" is missing, timestampToMillis(null) returns currentTimeMillis()
        val oldFormat =
            mapOf<String, Any?>(
                "text" to "Hello",
                "senderId" to "user-1",
                "senderName" to "Alice",
                "type" to "TEXT",
                "timestamp" to tsMillis,
            )
        val preview = ConversationPreview.fromMap(oldFormat)
        // createdAt should NOT be tsMillis (from "timestamp" key)
        assertTrue(preview.createdAt != tsMillis)
    }

    @Test
    fun `toMap uses createdAt key for Express API compatibility`() {
        val preview =
            ConversationPreview(
                text = "Hello",
                senderId = "user-1",
                senderName = "Alice",
                createdAt = tsMillis,
                type = "TEXT",
            )
        val map = preview.toMap()
        assertEquals(tsMillis, map["createdAt"])
        assertFalse(map.containsKey("timestamp"))
    }
}
