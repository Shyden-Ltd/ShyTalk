package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Test

class BroadcastFromMapTest {

    @Test
    fun `fromMap parses GIFT_SEND type`() {
        val map = mapOf<String, Any?>(
            "type" to "GIFT_SEND",
            "senderName" to "Alice",
            "senderPhotoUrl" to "https://example.com/photo.jpg",
            "recipientName" to "Bob",
            "giftName" to "Crown",
            "giftIconUrl" to "https://example.com/crown.png",
            "giftCoinValue" to 800L
        )

        val broadcast = Broadcast.fromMap(map, "b1")

        assertEquals("b1", broadcast.id)
        assertEquals(BroadcastType.GIFT_SEND, broadcast.type)
        assertEquals("Alice", broadcast.senderName)
        assertEquals("https://example.com/photo.jpg", broadcast.senderPhotoUrl)
        assertEquals("Bob", broadcast.recipientName)
        assertEquals("Crown", broadcast.giftName)
        assertEquals("https://example.com/crown.png", broadcast.giftIconUrl)
        assertEquals(800, broadcast.giftCoinValue)
    }

    @Test
    fun `fromMap parses GACHA_WIN type`() {
        val map = mapOf<String, Any?>(
            "type" to "GACHA_WIN",
            "senderName" to "Charlie",
            "giftName" to "Celestial Throne",
            "giftCoinValue" to 52000L
        )

        val broadcast = Broadcast.fromMap(map, "b2")

        assertEquals(BroadcastType.GACHA_WIN, broadcast.type)
        assertEquals("Charlie", broadcast.senderName)
        assertEquals("Celestial Throne", broadcast.giftName)
        assertEquals(52000, broadcast.giftCoinValue)
    }

    @Test
    fun `fromMap defaults to GIFT_SEND when type is missing`() {
        val map = mapOf<String, Any?>(
            "senderName" to "Alice",
            "recipientName" to "Bob",
            "giftName" to "Rose"
        )

        val broadcast = Broadcast.fromMap(map, "b3")

        assertEquals(BroadcastType.GIFT_SEND, broadcast.type)
    }

    @Test
    fun `fromMap defaults to GIFT_SEND for invalid type string`() {
        val map = mapOf<String, Any?>(
            "type" to "INVALID_TYPE",
            "senderName" to "Alice"
        )

        val broadcast = Broadcast.fromMap(map, "b4")

        assertEquals(BroadcastType.GIFT_SEND, broadcast.type)
    }

    @Test
    fun `fromMap handles empty map with defaults`() {
        val broadcast = Broadcast.fromMap(emptyMap(), "b5")

        assertEquals("b5", broadcast.id)
        assertEquals(BroadcastType.GIFT_SEND, broadcast.type)
        assertEquals("", broadcast.senderName)
        assertEquals(null, broadcast.senderPhotoUrl)
        assertEquals("", broadcast.recipientName)
        assertEquals("", broadcast.giftName)
        assertEquals("", broadcast.giftIconUrl)
        assertEquals(0, broadcast.giftCoinValue)
    }

    @Test
    fun `fromMap GACHA_WIN has empty recipientName`() {
        val map = mapOf<String, Any?>(
            "type" to "GACHA_WIN",
            "senderName" to "Winner",
            "recipientName" to "",
            "giftName" to "Dragon"
        )

        val broadcast = Broadcast.fromMap(map, "b6")

        assertEquals(BroadcastType.GACHA_WIN, broadcast.type)
        assertEquals("", broadcast.recipientName)
    }

    @Test
    fun `fromMap handles null type`() {
        val map = mapOf<String, Any?>(
            "type" to null,
            "senderName" to "Alice"
        )

        val broadcast = Broadcast.fromMap(map, "b7")

        assertEquals(BroadcastType.GIFT_SEND, broadcast.type)
    }
}
