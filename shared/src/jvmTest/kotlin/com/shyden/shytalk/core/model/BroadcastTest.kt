package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class BroadcastTest {
    // ── fromMap basic ───────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "type" to "GIFT_SEND",
                "senderName" to "Alice",
                "senderPhotoUrl" to "https://alice.png",
                "recipientName" to "Bob",
                "giftName" to "Rose",
                "giftIconUrl" to "https://rose.png",
                "giftCoinValue" to 100,
                "quantity" to 5,
                "timestamp" to 1705326600000L,
            )

        val broadcast = Broadcast.fromMap(map, "bc-1")

        assertEquals("bc-1", broadcast.id)
        assertEquals(BroadcastType.GIFT_SEND, broadcast.type)
        assertEquals("Alice", broadcast.senderName)
        assertEquals("https://alice.png", broadcast.senderPhotoUrl)
        assertEquals("Bob", broadcast.recipientName)
        assertEquals("Rose", broadcast.giftName)
        assertEquals("https://rose.png", broadcast.giftIconUrl)
        assertEquals(100, broadcast.giftCoinValue)
        assertEquals(5, broadcast.quantity)
        assertEquals(1705326600000L, broadcast.timestamp)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val broadcast = Broadcast.fromMap(emptyMap(), "bc-2")

        assertEquals("bc-2", broadcast.id)
        assertEquals(BroadcastType.GIFT_SEND, broadcast.type)
        assertEquals("", broadcast.senderName)
        assertNull(broadcast.senderPhotoUrl)
        assertEquals("", broadcast.recipientName)
        assertEquals("", broadcast.giftName)
        assertEquals("", broadcast.giftIconUrl)
        assertEquals(0, broadcast.giftCoinValue)
        assertEquals(1, broadcast.quantity)
        // timestamp falls back to currentTimeMillis via timestampToMillis(null)
    }

    // ── BroadcastType parsing ───────────────────────────────────────

    @Test
    fun `fromMap parses GACHA_WIN type`() {
        val map = mapOf<String, Any?>("type" to "GACHA_WIN")
        val broadcast = Broadcast.fromMap(map, "bc")
        assertEquals(BroadcastType.GACHA_WIN, broadcast.type)
    }

    @Test
    fun `fromMap parses GIFT_SEND type`() {
        val map = mapOf<String, Any?>("type" to "GIFT_SEND")
        val broadcast = Broadcast.fromMap(map, "bc")
        assertEquals(BroadcastType.GIFT_SEND, broadcast.type)
    }

    @Test
    fun `fromMap defaults to GIFT_SEND for unknown type`() {
        val map = mapOf<String, Any?>("type" to "INVALID")
        val broadcast = Broadcast.fromMap(map, "bc")
        assertEquals(BroadcastType.GIFT_SEND, broadcast.type)
    }

    @Test
    fun `fromMap defaults to GIFT_SEND for null type`() {
        val map = mapOf<String, Any?>("type" to null)
        val broadcast = Broadcast.fromMap(map, "bc")
        assertEquals(BroadcastType.GIFT_SEND, broadcast.type)
    }

    // ── Number type coercion ────────────────────────────────────────

    @Test
    fun `fromMap handles Long for giftCoinValue`() {
        val map = mapOf<String, Any?>("giftCoinValue" to 100L)
        val broadcast = Broadcast.fromMap(map, "bc")
        assertEquals(100, broadcast.giftCoinValue)
    }

    @Test
    fun `fromMap handles Double for quantity`() {
        val map = mapOf<String, Any?>("quantity" to 3.0)
        val broadcast = Broadcast.fromMap(map, "bc")
        assertEquals(3, broadcast.quantity)
    }

    @Test
    fun `fromMap handles Int for timestamp`() {
        val map = mapOf<String, Any?>("timestamp" to 1705326600000L)
        val broadcast = Broadcast.fromMap(map, "bc")
        assertEquals(1705326600000L, broadcast.timestamp)
    }

    // ── BroadcastType enum ──────────────────────────────────────────

    @Test
    fun `BroadcastType has expected values`() {
        val types = BroadcastType.entries
        assertEquals(2, types.size)
        assertEquals(BroadcastType.GIFT_SEND, BroadcastType.valueOf("GIFT_SEND"))
        assertEquals(BroadcastType.GACHA_WIN, BroadcastType.valueOf("GACHA_WIN"))
    }
}
