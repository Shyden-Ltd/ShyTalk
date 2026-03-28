package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class PrivateMessageTest {
    // ── fromMap basic ───────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "senderId" to "user-1",
                "senderName" to "Alice",
                "text" to "Hello",
                "imageUrls" to listOf("img1.png", "img2.png"),
                "type" to "TEXT",
                "createdAt" to 1705326600000L,
                "editedAt" to 1705326700000L,
                "editCount" to 2L,
                "readBy" to listOf("user-2", "user-3"),
                "replyToMessageId" to "orig-msg-1",
                "replyToText" to "Original message",
                "replyToSenderName" to "Bob",
                "stickerUrl" to "sticker.png",
                "roomInviteId" to "room-1",
                "roomInviteName" to "Cool Room",
                "reactions" to mapOf("thumbs_up" to listOf("user-2")),
                "isRecalled" to false,
                "isHidden" to true,
                "hiddenBy" to "mod-1",
            )

        val pm = PrivateMessage.fromMap(map, "pm-1")

        assertEquals("pm-1", pm.messageId)
        assertEquals("user-1", pm.senderId)
        assertEquals("Alice", pm.senderName)
        assertEquals("Hello", pm.text)
        assertEquals(listOf("img1.png", "img2.png"), pm.imageUrls)
        assertEquals(PrivateMessageType.TEXT, pm.type)
        assertEquals(1705326600000L, pm.createdAt)
        assertEquals(1705326700000L, pm.editedAt)
        assertEquals(2L, pm.editCount)
        assertEquals(listOf("user-2", "user-3"), pm.readBy)
        assertEquals("orig-msg-1", pm.replyToMessageId)
        assertEquals("Original message", pm.replyToText)
        assertEquals("Bob", pm.replyToSenderName)
        assertEquals("sticker.png", pm.stickerUrl)
        assertEquals("room-1", pm.roomInviteId)
        assertEquals("Cool Room", pm.roomInviteName)
        assertEquals(mapOf("thumbs_up" to listOf("user-2")), pm.reactions)
        assertFalse(pm.isRecalled)
        assertTrue(pm.isHidden)
        assertEquals("mod-1", pm.hiddenBy)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val pm = PrivateMessage.fromMap(emptyMap(), "pm-2")

        assertEquals("pm-2", pm.messageId)
        assertEquals("", pm.senderId)
        assertEquals("", pm.senderName)
        assertEquals("", pm.text)
        assertEquals(emptyList(), pm.imageUrls)
        assertEquals(PrivateMessageType.TEXT, pm.type)
        assertNull(pm.editedAt)
        assertEquals(0L, pm.editCount)
        assertEquals(emptyList(), pm.readBy)
        assertNull(pm.replyToMessageId)
        assertNull(pm.replyToText)
        assertNull(pm.replyToSenderName)
        assertNull(pm.stickerUrl)
        assertNull(pm.roomInviteId)
        assertNull(pm.roomInviteName)
        assertEquals(emptyMap(), pm.reactions)
        assertFalse(pm.isRecalled)
        assertFalse(pm.isHidden)
        assertNull(pm.hiddenBy)
    }

    // ── Type parsing ────────────────────────────────────────────────

    @Test
    fun `fromMap parses IMAGE type`() {
        val map = mapOf<String, Any?>("type" to "IMAGE")
        val pm = PrivateMessage.fromMap(map, "pm-3")
        assertEquals(PrivateMessageType.IMAGE, pm.type)
    }

    @Test
    fun `fromMap parses STICKER type`() {
        val map = mapOf<String, Any?>("type" to "STICKER")
        val pm = PrivateMessage.fromMap(map, "pm-4")
        assertEquals(PrivateMessageType.STICKER, pm.type)
    }

    @Test
    fun `fromMap parses ROOM_INVITE type`() {
        val map = mapOf<String, Any?>("type" to "ROOM_INVITE")
        val pm = PrivateMessage.fromMap(map, "pm-5")
        assertEquals(PrivateMessageType.ROOM_INVITE, pm.type)
    }

    @Test
    fun `fromMap parses MOD_ACTION type`() {
        val map = mapOf<String, Any?>("type" to "MOD_ACTION")
        val pm = PrivateMessage.fromMap(map, "pm-6")
        assertEquals(PrivateMessageType.MOD_ACTION, pm.type)
    }

    @Test
    fun `fromMap parses SYSTEM type`() {
        val map = mapOf<String, Any?>("type" to "SYSTEM")
        val pm = PrivateMessage.fromMap(map, "pm-7")
        assertEquals(PrivateMessageType.SYSTEM, pm.type)
    }

    @Test
    fun `fromMap defaults to TEXT for unknown type`() {
        val map = mapOf<String, Any?>("type" to "UNKNOWN_TYPE")
        val pm = PrivateMessage.fromMap(map, "pm-8")
        assertEquals(PrivateMessageType.TEXT, pm.type)
    }

    @Test
    fun `fromMap defaults to TEXT for null type`() {
        val map = mapOf<String, Any?>("type" to null)
        val pm = PrivateMessage.fromMap(map, "pm-9")
        assertEquals(PrivateMessageType.TEXT, pm.type)
    }

    // ── Timestamp fallback ──────────────────────────────────────────

    @Test
    fun `fromMap uses timestamp field as fallback for createdAt`() {
        val map = mapOf<String, Any?>("timestamp" to 1705326600000L)
        val pm = PrivateMessage.fromMap(map, "pm-ts")
        assertEquals(1705326600000L, pm.createdAt)
    }

    // ── Reactions parsing ───────────────────────────────────────────

    @Test
    fun `fromMap parses multiple reactions`() {
        val map =
            mapOf<String, Any?>(
                "reactions" to
                    mapOf(
                        "heart" to listOf("u1", "u2"),
                        "laugh" to listOf("u3"),
                    ),
            )
        val pm = PrivateMessage.fromMap(map, "pm-react")
        assertEquals(2, pm.reactions.size)
        assertEquals(listOf("u1", "u2"), pm.reactions["heart"])
        assertEquals(listOf("u3"), pm.reactions["laugh"])
    }

    @Test
    fun `fromMap handles empty reactions`() {
        val map = mapOf<String, Any?>("reactions" to emptyMap<String, Any>())
        val pm = PrivateMessage.fromMap(map, "pm-empty-react")
        assertEquals(emptyMap(), pm.reactions)
    }

    @Test
    fun `fromMap handles isRecalled as integer boolean`() {
        val map = mapOf<String, Any?>("isRecalled" to 1)
        val pm = PrivateMessage.fromMap(map, "pm-recalled")
        assertTrue(pm.isRecalled)
    }

    @Test
    fun `fromMap handles isHidden as integer boolean`() {
        val map = mapOf<String, Any?>("isHidden" to 1)
        val pm = PrivateMessage.fromMap(map, "pm-hidden")
        assertTrue(pm.isHidden)
    }

    // ── toMap ────────────────────────────────────────────────────────

    @Test
    fun `toMap includes all fields`() {
        val pm =
            PrivateMessage(
                messageId = "pm-1",
                senderId = "user-1",
                senderName = "Alice",
                text = "Hello",
                imageUrls = listOf("img.png"),
                type = PrivateMessageType.IMAGE,
                createdAt = 1705326600000L,
                editedAt = 1705326700000L,
                editCount = 1,
                readBy = listOf("user-2"),
                replyToMessageId = "orig-1",
                replyToText = "Original",
                replyToSenderName = "Bob",
                stickerUrl = null,
                roomInviteId = null,
                roomInviteName = null,
                reactions = mapOf("heart" to listOf("u1")),
                isRecalled = false,
                isHidden = true,
                hiddenBy = "mod-1",
            )

        val map = pm.toMap()

        assertEquals("pm-1", map["messageId"])
        assertEquals("user-1", map["senderId"])
        assertEquals("Alice", map["senderName"])
        assertEquals("Hello", map["text"])
        assertEquals(listOf("img.png"), map["imageUrls"])
        assertEquals("IMAGE", map["type"])
        assertEquals(1705326600000L, map["createdAt"])
        assertEquals(1705326700000L, map["editedAt"])
        assertEquals(1L, map["editCount"])
        assertEquals(listOf("user-2"), map["readBy"])
        assertEquals("orig-1", map["replyToMessageId"])
        assertEquals("Original", map["replyToText"])
        assertEquals("Bob", map["replyToSenderName"])
        assertNull(map["stickerUrl"])
        assertNull(map["roomInviteId"])
        assertNull(map["roomInviteName"])
        assertEquals(mapOf("heart" to listOf("u1")), map["reactions"])
        assertEquals(false, map["isRecalled"])
        assertEquals(true, map["isHidden"])
        assertEquals("mod-1", map["hiddenBy"])
    }

    // ── roundtrip ───────────────────────────────────────────────────

    @Test
    fun `toMap and fromMap roundtrip preserves data`() {
        val original =
            PrivateMessage(
                messageId = "pm-rt",
                senderId = "sender-1",
                senderName = "Sender",
                text = "Test text",
                imageUrls = listOf("a.png", "b.png"),
                type = PrivateMessageType.TEXT,
                createdAt = 1705326600000L,
                editedAt = 1705326700000L,
                editCount = 3,
                readBy = listOf("r1", "r2"),
                replyToMessageId = "reply-1",
                replyToText = "Reply text",
                replyToSenderName = "Replier",
                stickerUrl = "sticker.png",
                roomInviteId = "room-1",
                roomInviteName = "Room Name",
                reactions = mapOf("star" to listOf("u1", "u2")),
                isRecalled = true,
                isHidden = false,
                hiddenBy = null,
            )

        val map = original.toMap()
        val restored = PrivateMessage.fromMap(map, original.messageId)

        assertEquals(original.messageId, restored.messageId)
        assertEquals(original.senderId, restored.senderId)
        assertEquals(original.senderName, restored.senderName)
        assertEquals(original.text, restored.text)
        assertEquals(original.imageUrls, restored.imageUrls)
        assertEquals(original.type, restored.type)
        assertEquals(original.createdAt, restored.createdAt)
        assertEquals(original.editedAt, restored.editedAt)
        assertEquals(original.editCount, restored.editCount)
        assertEquals(original.readBy, restored.readBy)
        assertEquals(original.replyToMessageId, restored.replyToMessageId)
        assertEquals(original.replyToText, restored.replyToText)
        assertEquals(original.replyToSenderName, restored.replyToSenderName)
        assertEquals(original.stickerUrl, restored.stickerUrl)
        assertEquals(original.roomInviteId, restored.roomInviteId)
        assertEquals(original.roomInviteName, restored.roomInviteName)
        assertEquals(original.reactions, restored.reactions)
        assertEquals(original.isRecalled, restored.isRecalled)
        assertEquals(original.isHidden, restored.isHidden)
        assertEquals(original.hiddenBy, restored.hiddenBy)
    }

    // ── PrivateMessageType enum ─────────────────────────────────────

    @Test
    fun `PrivateMessageType has expected values`() {
        val types = PrivateMessageType.entries
        assertEquals(6, types.size)
        assertTrue(PrivateMessageType.TEXT in types)
        assertTrue(PrivateMessageType.IMAGE in types)
        assertTrue(PrivateMessageType.STICKER in types)
        assertTrue(PrivateMessageType.ROOM_INVITE in types)
        assertTrue(PrivateMessageType.MOD_ACTION in types)
        assertTrue(PrivateMessageType.SYSTEM in types)
    }

    // ── SendStatus enum ─────────────────────────────────────────────

    @Test
    fun `SendStatus has expected values`() {
        val statuses = SendStatus.entries
        assertEquals(3, statuses.size)
        assertTrue(SendStatus.SENT in statuses)
        assertTrue(SendStatus.SENDING in statuses)
        assertTrue(SendStatus.FAILED in statuses)
    }

    // ── Default constructor ─────────────────────────────────────────

    @Test
    fun `default constructor client-only fields`() {
        val pm = PrivateMessage()
        assertEquals(SendStatus.SENT, pm.sendStatus)
        assertEquals(emptyList(), pm.localImageData)
    }
}
