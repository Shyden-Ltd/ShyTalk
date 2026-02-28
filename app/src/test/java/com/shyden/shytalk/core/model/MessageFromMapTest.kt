package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Date

class MessageFromMapTest {

    private val tsMillis = 1_000_000_000L
    private val ts = Timestamp(Date(tsMillis))

    @Test
    fun `fromMap parses complete valid map`() {
        val map = mapOf<String, Any?>(
            "senderId" to "user-1",
            "senderName" to "Alice",
            "text" to "Hello",
            "createdAt" to ts,
            "type" to "TEXT"
        )
        val msg = Message.fromMap(map, "msg-1")
        assertEquals("msg-1", msg.messageId)
        assertEquals("user-1", msg.senderId)
        assertEquals("Alice", msg.senderName)
        assertEquals("Hello", msg.text)
        assertEquals(tsMillis, msg.createdAt)
        assertEquals(MessageType.TEXT, msg.type)
    }

    @Test
    fun `fromMap defaults type to TEXT for invalid value`() {
        val map = mapOf<String, Any?>("type" to "INVALID")
        val msg = Message.fromMap(map, "msg-1")
        assertEquals(MessageType.TEXT, msg.type)
    }

    @Test
    fun `fromMap defaults type to TEXT when missing`() {
        val msg = Message.fromMap(emptyMap(), "msg-1")
        assertEquals(MessageType.TEXT, msg.type)
    }

    @Test
    fun `fromMap parses SYSTEM type`() {
        val map = mapOf<String, Any?>("type" to "SYSTEM")
        val msg = Message.fromMap(map, "msg-1")
        assertEquals(MessageType.SYSTEM, msg.type)
    }

    @Test
    fun `fromMap parses JOIN type`() {
        val map = mapOf<String, Any?>("type" to "JOIN")
        val msg = Message.fromMap(map, "msg-1")
        assertEquals(MessageType.JOIN, msg.type)
    }

    @Test
    fun `fromMap parses GIFT type`() {
        val map = mapOf<String, Any?>(
            "type" to "GIFT",
            "giftId" to "rose",
            "giftIconUrl" to "https://example.com/rose.png"
        )
        val msg = Message.fromMap(map, "msg-1")
        assertEquals(MessageType.GIFT, msg.type)
        assertEquals("rose", msg.giftId)
        assertEquals("https://example.com/rose.png", msg.giftIconUrl)
    }

    @Test
    fun `fromMap defaults giftId and giftIconUrl when missing`() {
        val msg = Message.fromMap(emptyMap(), "msg-1")
        assertEquals("", msg.giftId)
        assertEquals("", msg.giftIconUrl)
    }

    @Test
    fun `fromMap handles empty map with all defaults`() {
        val msg = Message.fromMap(emptyMap(), "msg-1")
        assertEquals("msg-1", msg.messageId)
        assertEquals("", msg.senderId)
        assertEquals("", msg.senderName)
        assertEquals("", msg.text)
        assertEquals(MessageType.TEXT, msg.type)
        assertEquals("", msg.giftId)
        assertEquals("", msg.giftIconUrl)
    }

    @Test
    fun `toMap produces correct map`() {
        val msg = Message(
            messageId = "msg-1",
            senderId = "user-1",
            senderName = "Alice",
            text = "Hello",
            createdAt = tsMillis,
            type = MessageType.SYSTEM
        )
        val map = msg.toMap()
        assertEquals("msg-1", map["messageId"])
        assertEquals("user-1", map["senderId"])
        assertEquals("Alice", map["senderName"])
        assertEquals("Hello", map["text"])
        assertEquals(tsMillis, map["createdAt"])
        assertEquals("SYSTEM", map["type"])
    }

    @Test
    fun `toMap includes giftId and giftIconUrl for GIFT type`() {
        val msg = Message(
            messageId = "msg-1",
            senderId = "user-1",
            senderName = "Alice",
            text = "Alice sent Rose to Bob",
            createdAt = tsMillis,
            type = MessageType.GIFT,
            giftId = "rose",
            giftIconUrl = "https://example.com/rose.png"
        )
        val map = msg.toMap()
        assertEquals("GIFT", map["type"])
        assertEquals("rose", map["giftId"])
        assertEquals("https://example.com/rose.png", map["giftIconUrl"])
    }
}
