package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MessageTest {
    // ── fromMap basic ───────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "senderId" to "user-1",
                "senderName" to "Alice",
                "text" to "Hello world",
                "createdAt" to 1705326600000L,
                "type" to "TEXT",
                "isEdited" to false,
                "giftId" to "gift-1",
                "giftIconUrl" to "https://icon.png",
            )

        val msg = Message.fromMap(map, "msg-1")

        assertEquals("msg-1", msg.messageId)
        assertEquals("user-1", msg.senderId)
        assertEquals("Alice", msg.senderName)
        assertEquals("Hello world", msg.text)
        assertEquals(1705326600000L, msg.createdAt)
        assertEquals(MessageType.TEXT, msg.type)
        assertFalse(msg.isEdited)
        assertEquals("gift-1", msg.giftId)
        assertEquals("https://icon.png", msg.giftIconUrl)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val msg = Message.fromMap(emptyMap(), "msg-2")

        assertEquals("msg-2", msg.messageId)
        assertEquals("", msg.senderId)
        assertEquals("", msg.senderName)
        assertEquals("", msg.text)
        assertEquals(MessageType.TEXT, msg.type)
        assertFalse(msg.isEdited)
        assertEquals("", msg.giftId)
        assertEquals("", msg.giftIconUrl)
    }

    @Test
    fun `fromMap parses SYSTEM type`() {
        val map = mapOf<String, Any?>("type" to "SYSTEM")
        val msg = Message.fromMap(map, "msg-3")
        assertEquals(MessageType.SYSTEM, msg.type)
    }

    @Test
    fun `fromMap parses JOIN type`() {
        val map = mapOf<String, Any?>("type" to "JOIN")
        val msg = Message.fromMap(map, "msg-4")
        assertEquals(MessageType.JOIN, msg.type)
    }

    @Test
    fun `fromMap parses GIFT type`() {
        val map = mapOf<String, Any?>("type" to "GIFT")
        val msg = Message.fromMap(map, "msg-5")
        assertEquals(MessageType.GIFT, msg.type)
    }

    @Test
    fun `fromMap defaults to TEXT for unknown type`() {
        val map = mapOf<String, Any?>("type" to "UNKNOWN_TYPE")
        val msg = Message.fromMap(map, "msg-6")
        assertEquals(MessageType.TEXT, msg.type)
    }

    @Test
    fun `fromMap defaults to TEXT for null type`() {
        val map = mapOf<String, Any?>("type" to null)
        val msg = Message.fromMap(map, "msg-7")
        assertEquals(MessageType.TEXT, msg.type)
    }

    @Test
    fun `fromMap handles isEdited as integer boolean`() {
        val map = mapOf<String, Any?>("isEdited" to 1)
        val msg = Message.fromMap(map, "msg-8")
        assertTrue(msg.isEdited)
    }

    @Test
    fun `fromMap handles isEdited as integer boolean 0`() {
        val map = mapOf<String, Any?>("isEdited" to 0)
        val msg = Message.fromMap(map, "msg-9")
        assertFalse(msg.isEdited)
    }

    // ── toMap ────────────────────────────────────────────────────────

    @Test
    fun `toMap includes all fields`() {
        val msg =
            Message(
                messageId = "msg-1",
                senderId = "user-1",
                senderName = "Alice",
                text = "Hello",
                createdAt = 1705326600000L,
                type = MessageType.GIFT,
                isEdited = true,
                giftId = "gift-1",
                giftIconUrl = "icon.png",
            )

        val map = msg.toMap()

        assertEquals("msg-1", map["messageId"])
        assertEquals("user-1", map["senderId"])
        assertEquals("Alice", map["senderName"])
        assertEquals("Hello", map["text"])
        assertEquals(1705326600000L, map["createdAt"])
        assertEquals("GIFT", map["type"])
        assertEquals(true, map["isEdited"])
        assertEquals("gift-1", map["giftId"])
        assertEquals("icon.png", map["giftIconUrl"])
    }

    // ── roundtrip ───────────────────────────────────────────────────

    @Test
    fun `toMap and fromMap roundtrip preserves data`() {
        val original =
            Message(
                messageId = "msg-rt",
                senderId = "sender-1",
                senderName = "Bob",
                text = "Test message",
                createdAt = 1705326600000L,
                type = MessageType.SYSTEM,
                isEdited = true,
                giftId = "g-1",
                giftIconUrl = "https://gift.icon",
            )

        val map = original.toMap()
        val restored = Message.fromMap(map, original.messageId)

        assertEquals(original, restored)
    }

    @Test
    fun `roundtrip for TEXT type`() {
        val original =
            Message(
                messageId = "msg-text",
                senderId = "u1",
                senderName = "User",
                text = "Plain text",
                createdAt = 1705326600000L,
                type = MessageType.TEXT,
            )

        val restored = Message.fromMap(original.toMap(), original.messageId)
        assertEquals(original, restored)
    }

    // ── MessageType enum ────────────────────────────────────────────

    @Test
    fun `MessageType has expected values`() {
        val types = MessageType.entries
        assertEquals(4, types.size)
        assertTrue(MessageType.TEXT in types)
        assertTrue(MessageType.SYSTEM in types)
        assertTrue(MessageType.JOIN in types)
        assertTrue(MessageType.GIFT in types)
    }
}
