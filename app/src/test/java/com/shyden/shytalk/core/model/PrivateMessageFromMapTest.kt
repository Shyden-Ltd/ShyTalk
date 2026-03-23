package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Date

class PrivateMessageFromMapTest {
    private val tsMillis = 1_000_000_000L
    private val ts = Timestamp(Date(tsMillis))

    @Test
    fun `fromMap parses complete valid map`() {
        val map =
            mapOf<String, Any?>(
                "senderId" to "user-1",
                "senderName" to "Alice",
                "text" to "Hello!",
                "imageUrls" to listOf("https://img1.png", "https://img2.png"),
                "type" to "IMAGE",
                "createdAt" to ts,
                "editedAt" to ts,
                "editCount" to 2L,
                "readBy" to listOf("user-2", "user-3"),
                "replyToMessageId" to "msg-99",
                "replyToText" to "Original",
                "replyToSenderName" to "Bob",
                "reactions" to mapOf("👍" to listOf("user-2"), "❤️" to listOf("user-1", "user-3")),
            )
        val msg = PrivateMessage.fromMap(map, "pm-1")

        assertEquals("pm-1", msg.messageId)
        assertEquals("user-1", msg.senderId)
        assertEquals("Alice", msg.senderName)
        assertEquals("Hello!", msg.text)
        assertEquals(listOf("https://img1.png", "https://img2.png"), msg.imageUrls)
        assertEquals(PrivateMessageType.IMAGE, msg.type)
        assertEquals(tsMillis, msg.createdAt)
        assertEquals(tsMillis, msg.editedAt)
        assertEquals(2L, msg.editCount)
        assertEquals(listOf("user-2", "user-3"), msg.readBy)
        assertEquals("msg-99", msg.replyToMessageId)
        assertEquals("Original", msg.replyToText)
        assertEquals("Bob", msg.replyToSenderName)
        assertEquals(mapOf("👍" to listOf("user-2"), "❤️" to listOf("user-1", "user-3")), msg.reactions)
    }

    @Test
    fun `fromMap handles empty map with all defaults`() {
        val msg = PrivateMessage.fromMap(emptyMap(), "pm-1")

        assertEquals("pm-1", msg.messageId)
        assertEquals("", msg.senderId)
        assertEquals("", msg.senderName)
        assertEquals("", msg.text)
        assertEquals(emptyList<String>(), msg.imageUrls)
        assertEquals(PrivateMessageType.TEXT, msg.type)
        assertEquals(0L, msg.editCount)
        assertEquals(emptyList<String>(), msg.readBy)
        assertNull(msg.replyToMessageId)
        assertNull(msg.replyToText)
        assertNull(msg.replyToSenderName)
        assertNull(msg.roomInviteId)
        assertNull(msg.roomInviteName)
        assertEquals(emptyMap<String, List<String>>(), msg.reactions)
    }

    @Test
    fun `fromMap defaults type to TEXT for invalid value`() {
        val map = mapOf<String, Any?>("type" to "INVALID_TYPE")
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(PrivateMessageType.TEXT, msg.type)
    }

    @Test
    fun `fromMap defaults type to TEXT when missing`() {
        val map = mapOf<String, Any?>("type" to null)
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(PrivateMessageType.TEXT, msg.type)
    }

    @Test
    fun `fromMap filters non-string items from imageUrls`() {
        val map =
            mapOf<String, Any?>(
                "imageUrls" to listOf("https://img1.png", 42, null, "https://img2.png"),
            )
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(listOf("https://img1.png", "https://img2.png"), msg.imageUrls)
    }

    @Test
    fun `fromMap defaults imageUrls to empty when null`() {
        val map = mapOf<String, Any?>("imageUrls" to null)
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(emptyList<String>(), msg.imageUrls)
    }

    @Test
    fun `fromMap filters non-string items from readBy`() {
        val map =
            mapOf<String, Any?>(
                "readBy" to listOf("user-1", 99, null, "user-2"),
            )
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(listOf("user-1", "user-2"), msg.readBy)
    }

    @Test
    fun `fromMap defaults readBy to empty when null`() {
        val map = mapOf<String, Any?>("readBy" to null)
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(emptyList<String>(), msg.readBy)
    }

    @Test
    fun `fromMap parses reactions with valid nested map`() {
        val map =
            mapOf<String, Any?>(
                "reactions" to mapOf("👍" to listOf("user-1", "user-2"), "🔥" to listOf("user-3")),
            )
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(2, msg.reactions.size)
        assertEquals(listOf("user-1", "user-2"), msg.reactions["👍"])
        assertEquals(listOf("user-3"), msg.reactions["🔥"])
    }

    @Test
    fun `fromMap defaults reactions to empty when null`() {
        val map = mapOf<String, Any?>("reactions" to null)
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(emptyMap<String, List<String>>(), msg.reactions)
    }

    @Test
    fun `fromMap skips reaction entries with non-string keys`() {
        val map =
            mapOf<String, Any?>(
                "reactions" to mapOf(42 to listOf("user-1"), "👍" to listOf("user-2")),
            )
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(1, msg.reactions.size)
        assertEquals(listOf("user-2"), msg.reactions["👍"])
    }

    @Test
    fun `fromMap handles nullable reply fields`() {
        val map =
            mapOf<String, Any?>(
                "replyToMessageId" to null,
                "replyToText" to null,
                "replyToSenderName" to null,
            )
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertNull(msg.replyToMessageId)
        assertNull(msg.replyToText)
        assertNull(msg.replyToSenderName)
    }

    @Test
    fun `fromMap handles editedAt when null`() {
        val map = mapOf<String, Any?>("editedAt" to null)
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertNull(msg.editedAt)
    }

    @Test
    fun `fromMap of toMap produces equivalent message`() {
        val original =
            PrivateMessage(
                messageId = "pm-1",
                senderId = "user-1",
                senderName = "Alice",
                text = "Hello!",
                imageUrls = listOf("https://img1.png"),
                type = PrivateMessageType.IMAGE,
                createdAt = tsMillis,
                editedAt = tsMillis,
                editCount = 1,
                readBy = listOf("user-2"),
                replyToMessageId = "msg-99",
                replyToText = "Original",
                replyToSenderName = "Bob",
                reactions = mapOf("👍" to listOf("user-2")),
            )
        val roundtripped = PrivateMessage.fromMap(original.toMap(), "pm-1")
        assertEquals(original, roundtripped)
    }

    // ===== STICKER type =====

    @Test
    fun `fromMap parses STICKER type`() {
        val map = mapOf<String, Any?>("type" to "STICKER", "stickerUrl" to "https://sticker.png")
        val msg = PrivateMessage.fromMap(map, "pm-sticker")
        assertEquals(PrivateMessageType.STICKER, msg.type)
        assertEquals("https://sticker.png", msg.stickerUrl)
    }

    @Test
    fun `fromMap defaults stickerUrl to null when missing`() {
        val msg = PrivateMessage.fromMap(emptyMap(), "pm-1")
        assertNull(msg.stickerUrl)
    }

    @Test
    fun `toMap includes stickerUrl`() {
        val msg =
            PrivateMessage(
                messageId = "pm-1",
                type = PrivateMessageType.STICKER,
                stickerUrl = "https://sticker.png",
                createdAt = tsMillis,
            )
        val map = msg.toMap()
        assertEquals("STICKER", map["type"])
        assertEquals("https://sticker.png", map["stickerUrl"])
    }

    @Test
    fun `fromMap of toMap round-trip for STICKER message`() {
        val original =
            PrivateMessage(
                messageId = "pm-s",
                senderId = "user-1",
                senderName = "Alice",
                text = "",
                type = PrivateMessageType.STICKER,
                stickerUrl = "https://sticker.png",
                createdAt = tsMillis,
            )
        val roundtripped = PrivateMessage.fromMap(original.toMap(), "pm-s")
        assertEquals(original, roundtripped)
    }

    // ===== ROOM_INVITE type =====

    @Test
    fun `fromMap parses ROOM_INVITE type`() {
        val map =
            mapOf<String, Any?>(
                "type" to "ROOM_INVITE",
                "roomInviteId" to "room-123",
                "roomInviteName" to "Fun Room",
            )
        val msg = PrivateMessage.fromMap(map, "pm-invite")
        assertEquals(PrivateMessageType.ROOM_INVITE, msg.type)
        assertEquals("room-123", msg.roomInviteId)
        assertEquals("Fun Room", msg.roomInviteName)
    }

    @Test
    fun `toMap includes roomInviteId and roomInviteName`() {
        val msg =
            PrivateMessage(
                messageId = "pm-1",
                type = PrivateMessageType.ROOM_INVITE,
                roomInviteId = "room-123",
                roomInviteName = "Fun Room",
                createdAt = tsMillis,
            )
        val map = msg.toMap()
        assertEquals("ROOM_INVITE", map["type"])
        assertEquals("room-123", map["roomInviteId"])
        assertEquals("Fun Room", map["roomInviteName"])
    }

    @Test
    fun `fromMap of toMap round-trip for ROOM_INVITE message`() {
        val original =
            PrivateMessage(
                messageId = "pm-ri",
                senderId = "user-1",
                senderName = "Alice",
                text = "",
                type = PrivateMessageType.ROOM_INVITE,
                roomInviteId = "room-123",
                roomInviteName = "Fun Room",
                createdAt = tsMillis,
            )
        val roundtripped = PrivateMessage.fromMap(original.toMap(), "pm-ri")
        assertEquals(original, roundtripped)
    }

    // ===== isRecalled =====

    @Test
    fun `fromMap parses isRecalled true`() {
        val map = mapOf<String, Any?>("isRecalled" to true)
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(true, msg.isRecalled)
    }

    @Test
    fun `fromMap defaults isRecalled to false when missing`() {
        val msg = PrivateMessage.fromMap(emptyMap(), "pm-1")
        assertEquals(false, msg.isRecalled)
    }

    @Test
    fun `toMap includes isRecalled`() {
        val msg = PrivateMessage(messageId = "pm-1", isRecalled = true, createdAt = tsMillis)
        val map = msg.toMap()
        assertEquals(true, map["isRecalled"])
    }

    @Test
    fun `fromMap of toMap round-trip for recalled message`() {
        val original =
            PrivateMessage(
                messageId = "pm-recalled",
                senderId = "user-1",
                senderName = "Alice",
                text = "Original text",
                isRecalled = true,
                createdAt = tsMillis,
            )
        val roundtripped = PrivateMessage.fromMap(original.toMap(), "pm-recalled")
        assertEquals(original, roundtripped)
    }

    // ===== localImageData =====

    @Test
    fun `toMap does not include localImageData`() {
        val msg =
            PrivateMessage(
                messageId = "pm-1",
                localImageData = listOf(byteArrayOf(1, 2, 3)),
                createdAt = tsMillis,
            )
        val map = msg.toMap()
        assertNull(map["localImageData"])
    }

    @Test
    fun `localImageData defaults to empty`() {
        val msg = PrivateMessage.fromMap(emptyMap(), "pm-1")
        assertEquals(emptyList<ByteArray>(), msg.localImageData)
    }

    // ===== isHidden / hiddenBy =====

    @Test
    fun `fromMap parses isHidden true`() {
        val map = mapOf<String, Any?>("isHidden" to true)
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(true, msg.isHidden)
    }

    @Test
    fun `fromMap defaults isHidden to false when missing`() {
        val msg = PrivateMessage.fromMap(emptyMap(), "pm-1")
        assertEquals(false, msg.isHidden)
    }

    @Test
    fun `fromMap parses hiddenBy`() {
        val map =
            mapOf<String, Any?>(
                "isHidden" to true,
                "hiddenBy" to "mod-1",
            )
        val msg = PrivateMessage.fromMap(map, "pm-1")
        assertEquals(true, msg.isHidden)
        assertEquals("mod-1", msg.hiddenBy)
    }

    @Test
    fun `fromMap defaults hiddenBy to null when missing`() {
        val msg = PrivateMessage.fromMap(emptyMap(), "pm-1")
        assertNull(msg.hiddenBy)
    }

    @Test
    fun `toMap includes isHidden and hiddenBy`() {
        val msg =
            PrivateMessage(
                messageId = "pm-1",
                isHidden = true,
                hiddenBy = "mod-1",
                createdAt = tsMillis,
            )
        val map = msg.toMap()
        assertEquals(true, map["isHidden"])
        assertEquals("mod-1", map["hiddenBy"])
    }

    @Test
    fun `fromMap of toMap round-trip for hidden message`() {
        val original =
            PrivateMessage(
                messageId = "pm-hidden",
                senderId = "user-1",
                senderName = "Alice",
                text = "Bad message",
                isHidden = true,
                hiddenBy = "mod-1",
                createdAt = tsMillis,
            )
        val roundtripped = PrivateMessage.fromMap(original.toMap(), "pm-hidden")
        assertEquals(original, roundtripped)
    }

    // ===== MOD_ACTION / SYSTEM types =====

    @Test
    fun `fromMap parses MOD_ACTION type`() {
        val map = mapOf<String, Any?>("type" to "MOD_ACTION")
        val msg = PrivateMessage.fromMap(map, "pm-mod")
        assertEquals(PrivateMessageType.MOD_ACTION, msg.type)
    }

    @Test
    fun `fromMap parses SYSTEM type`() {
        val map = mapOf<String, Any?>("type" to "SYSTEM")
        val msg = PrivateMessage.fromMap(map, "pm-sys")
        assertEquals(PrivateMessageType.SYSTEM, msg.type)
    }

    @Test
    fun `toMap serializes MOD_ACTION type`() {
        val msg =
            PrivateMessage(
                messageId = "pm-1",
                type = PrivateMessageType.MOD_ACTION,
                createdAt = tsMillis,
            )
        assertEquals("MOD_ACTION", msg.toMap()["type"])
    }

    @Test
    fun `toMap serializes SYSTEM type`() {
        val msg =
            PrivateMessage(
                messageId = "pm-1",
                type = PrivateMessageType.SYSTEM,
                createdAt = tsMillis,
            )
        assertEquals("SYSTEM", msg.toMap()["type"])
    }

    @Test
    fun `PrivateMessageType enum has six values`() {
        val values = PrivateMessageType.entries
        assertEquals(6, values.size)
    }
}
