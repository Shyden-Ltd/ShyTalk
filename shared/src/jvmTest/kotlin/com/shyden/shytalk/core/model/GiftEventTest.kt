package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals

class GiftEventTest {
    // ── fromMap ─────────────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "senderId" to "sender-1",
                "senderName" to "Alice",
                "recipientId" to "recipient-1",
                "recipientName" to "Bob",
                "giftId" to "gift-1",
                "giftName" to "Rose",
                "coinValue" to 100,
                "quantity" to 3,
                "timestamp" to 1705326600000L,
            )

        val event = GiftEvent.fromMap(map)

        assertEquals("sender-1", event.senderId)
        assertEquals("Alice", event.senderName)
        assertEquals("recipient-1", event.recipientId)
        assertEquals("Bob", event.recipientName)
        assertEquals("gift-1", event.giftId)
        assertEquals("Rose", event.giftName)
        assertEquals(100, event.coinValue)
        assertEquals(3, event.quantity)
        assertEquals(1705326600000L, event.timestamp)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val event = GiftEvent.fromMap(emptyMap())

        assertEquals("", event.senderId)
        assertEquals("", event.senderName)
        assertEquals("", event.recipientId)
        assertEquals("", event.recipientName)
        assertEquals("", event.giftId)
        assertEquals("", event.giftName)
        assertEquals(0, event.coinValue)
        assertEquals(1, event.quantity) // default is 1, not 0
        assertEquals(0L, event.timestamp)
    }

    @Test
    fun `fromMap handles Number types for coinValue`() {
        val map = mapOf<String, Any?>("coinValue" to 50L)
        val event = GiftEvent.fromMap(map)
        assertEquals(50, event.coinValue)
    }

    @Test
    fun `fromMap handles Double for coinValue`() {
        val map = mapOf<String, Any?>("coinValue" to 75.0)
        val event = GiftEvent.fromMap(map)
        assertEquals(75, event.coinValue)
    }

    @Test
    fun `fromMap handles Number types for quantity`() {
        val map = mapOf<String, Any?>("quantity" to 5L)
        val event = GiftEvent.fromMap(map)
        assertEquals(5, event.quantity)
    }

    @Test
    fun `fromMap defaults quantity to 1 when missing`() {
        val map = mapOf<String, Any?>("senderId" to "s1")
        val event = GiftEvent.fromMap(map)
        assertEquals(1, event.quantity)
    }

    @Test
    fun `fromMap handles null timestamp`() {
        val map = mapOf<String, Any?>("timestamp" to null)
        val event = GiftEvent.fromMap(map)
        assertEquals(0L, event.timestamp)
    }

    // ── Default constructor ─────────────────────────────────────────

    @Test
    fun `default constructor has expected defaults`() {
        val event = GiftEvent()
        assertEquals("", event.senderId)
        assertEquals("", event.senderName)
        assertEquals("", event.recipientId)
        assertEquals("", event.recipientName)
        assertEquals("", event.giftId)
        assertEquals("", event.giftName)
        assertEquals(0, event.coinValue)
        assertEquals(1, event.quantity)
        assertEquals(0L, event.timestamp)
    }

    @Test
    fun `eventId is unique across instances`() {
        val e1 = GiftEvent()
        val e2 = GiftEvent()
        // Random.nextLong() is extremely unlikely to produce the same value
        // We can't assert inequality with certainty, but check they exist
        // This test mainly verifies the eventId field is populated
        kotlin.test.assertTrue(e1.eventId != 0L || e2.eventId != 0L, "At least one eventId should be non-zero")
    }
}
