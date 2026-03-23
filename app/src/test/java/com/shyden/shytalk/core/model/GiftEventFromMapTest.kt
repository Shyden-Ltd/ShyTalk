package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Date

class GiftEventFromMapTest {
    private val tsMillis = 1_000_000_000L
    private val ts = Timestamp(Date(tsMillis))

    @Test
    fun `fromMap parses complete valid map`() {
        val map =
            mapOf<String, Any?>(
                "senderId" to "sender-1",
                "senderName" to "Alice",
                "recipientId" to "recipient-1",
                "recipientName" to "Bob",
                "giftId" to "crown",
                "giftName" to "Crown",
                "coinValue" to 800L,
                "timestamp" to ts,
            )

        val event = GiftEvent.fromMap(map)

        assertEquals("sender-1", event.senderId)
        assertEquals("Alice", event.senderName)
        assertEquals("recipient-1", event.recipientId)
        assertEquals("Bob", event.recipientName)
        assertEquals("crown", event.giftId)
        assertEquals("Crown", event.giftName)
        assertEquals(800, event.coinValue)
        assertEquals(tsMillis, event.timestamp)
    }

    @Test
    fun `fromMap handles empty map with defaults`() {
        val event = GiftEvent.fromMap(emptyMap())

        assertEquals("", event.senderId)
        assertEquals("", event.senderName)
        assertEquals("", event.recipientId)
        assertEquals("", event.recipientName)
        assertEquals("", event.giftId)
        assertEquals("", event.giftName)
        assertEquals(0, event.coinValue)
        assertEquals(0L, event.timestamp)
    }

    @Test
    fun `fromMap handles null values with defaults`() {
        val map =
            mapOf<String, Any?>(
                "senderId" to null,
                "senderName" to null,
                "recipientId" to null,
                "recipientName" to null,
                "giftId" to null,
                "giftName" to null,
                "coinValue" to null,
                "timestamp" to null,
            )

        val event = GiftEvent.fromMap(map)

        assertEquals("", event.senderId)
        assertEquals("", event.senderName)
        assertEquals("", event.recipientId)
        assertEquals("", event.recipientName)
        assertEquals("", event.giftId)
        assertEquals("", event.giftName)
        assertEquals(0, event.coinValue)
        assertEquals(0L, event.timestamp)
    }

    @Test
    fun `fromMap parses coinValue from Long`() {
        val map = mapOf<String, Any?>("coinValue" to 5000L)
        val event = GiftEvent.fromMap(map)
        assertEquals(5000, event.coinValue)
    }

    @Test
    fun `fromMap parses timestamp from Firestore Timestamp`() {
        val millis = 1_700_000_000_000L
        val firebaseTs = Timestamp(Date(millis))
        val map = mapOf<String, Any?>("timestamp" to firebaseTs)
        val event = GiftEvent.fromMap(map)
        assertEquals(millis, event.timestamp)
    }

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
        assertEquals(0L, event.timestamp)
    }

    @Test
    fun `fromMap ignores extra fields`() {
        val map =
            mapOf<String, Any?>(
                "senderId" to "sender-1",
                "unknownField" to "whatever",
                "anotherField" to 42L,
            )
        val event = GiftEvent.fromMap(map)
        assertEquals("sender-1", event.senderId)
    }

    @Test
    fun `fromMap with missing fields returns defaults for absent keys`() {
        val map =
            mapOf<String, Any?>(
                "senderId" to "sender-1",
                "giftId" to "crown",
            )
        val event = GiftEvent.fromMap(map)

        assertEquals("sender-1", event.senderId)
        assertEquals("", event.senderName)
        assertEquals("", event.recipientId)
        assertEquals("", event.recipientName)
        assertEquals("crown", event.giftId)
        assertEquals("", event.giftName)
        assertEquals(0, event.coinValue)
        assertEquals(0L, event.timestamp)
    }

    @Test
    fun `fromMap with wrong types returns defaults for string and numeric fields`() {
        val map =
            mapOf<String, Any?>(
                "senderId" to 12345L,
                "senderName" to true,
                "recipientId" to listOf("a"),
                "recipientName" to 99.9,
                "giftId" to mapOf("nested" to "value"),
                "giftName" to 0,
                "coinValue" to "not a number",
            )
        val event = GiftEvent.fromMap(map)

        assertEquals("", event.senderId)
        assertEquals("", event.senderName)
        assertEquals("", event.recipientId)
        assertEquals("", event.recipientName)
        assertEquals("", event.giftId)
        assertEquals("", event.giftName)
        assertEquals(0, event.coinValue)
    }

    @Test
    fun `fromMap with unrecognized timestamp type falls back to current time`() {
        // timestampToMillis returns currentTimeMillis() for unrecognized types
        val before = System.currentTimeMillis()
        val map =
            mapOf<String, Any?>(
                "timestamp" to "not a timestamp",
            )
        val event = GiftEvent.fromMap(map)
        val after = System.currentTimeMillis()

        assertTrue(event.timestamp in before..after)
    }

    // ===== quantity field =====

    @Test
    fun `fromMap parses quantity from Long`() {
        val map = mapOf<String, Any?>("quantity" to 5L)
        val event = GiftEvent.fromMap(map)
        assertEquals(5, event.quantity)
    }

    @Test
    fun `fromMap defaults quantity to 1 when missing`() {
        val map =
            mapOf<String, Any?>(
                "senderId" to "sender-1",
                "giftId" to "crown",
            )
        val event = GiftEvent.fromMap(map)
        assertEquals(1, event.quantity)
    }

    @Test
    fun `fromMap defaults quantity to 1 when null`() {
        val map = mapOf<String, Any?>("quantity" to null)
        val event = GiftEvent.fromMap(map)
        assertEquals(1, event.quantity)
    }

    @Test
    fun `fromMap defaults quantity to 1 when wrong type`() {
        val map = mapOf<String, Any?>("quantity" to "not a number")
        val event = GiftEvent.fromMap(map)
        assertEquals(1, event.quantity)
    }

    @Test
    fun `default constructor has quantity 1`() {
        val event = GiftEvent()
        assertEquals(1, event.quantity)
    }

    @Test
    fun `fromMap parses complete map including quantity`() {
        val map =
            mapOf<String, Any?>(
                "senderId" to "sender-1",
                "senderName" to "Alice",
                "recipientId" to "recipient-1",
                "recipientName" to "Bob",
                "giftId" to "crown",
                "giftName" to "Crown",
                "coinValue" to 800L,
                "quantity" to 3L,
                "timestamp" to ts,
            )

        val event = GiftEvent.fromMap(map)

        assertEquals("sender-1", event.senderId)
        assertEquals("Alice", event.senderName)
        assertEquals("recipient-1", event.recipientId)
        assertEquals("Bob", event.recipientName)
        assertEquals("crown", event.giftId)
        assertEquals("Crown", event.giftName)
        assertEquals(800, event.coinValue)
        assertEquals(3, event.quantity)
        assertEquals(tsMillis, event.timestamp)
    }
}
