package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class GiftWallEntryTest {
    // ── fromMap ─────────────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "receivedCount" to 100,
                "senders" to mapOf("user-1" to 50, "user-2" to 30, "user-3" to 20),
                "topSenderId" to "user-1",
                "topSenderCount" to 50,
            )

        val entry = GiftWallEntry.fromMap(map, "gift-1")

        assertEquals("gift-1", entry.giftId)
        assertEquals(100, entry.receivedCount)
        assertEquals(3, entry.senders.size)
        assertEquals(50, entry.senders["user-1"])
        assertEquals(30, entry.senders["user-2"])
        assertEquals(20, entry.senders["user-3"])
        assertEquals("user-1", entry.topSenderId)
        assertEquals(50, entry.topSenderCount)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val entry = GiftWallEntry.fromMap(emptyMap(), "gift-2")

        assertEquals("gift-2", entry.giftId)
        assertEquals(0, entry.receivedCount)
        assertEquals(emptyMap(), entry.senders)
        assertNull(entry.topSenderId)
        assertEquals(0, entry.topSenderCount)
    }

    @Test
    fun `fromMap handles Number types for receivedCount`() {
        val map = mapOf<String, Any?>("receivedCount" to 42L)
        val entry = GiftWallEntry.fromMap(map, "g1")
        assertEquals(42, entry.receivedCount)
    }

    @Test
    fun `fromMap handles Number types for sender counts`() {
        val map =
            mapOf<String, Any?>(
                "senders" to mapOf("u1" to 10L),
            )
        val entry = GiftWallEntry.fromMap(map, "g1")
        assertEquals(10, entry.senders["u1"])
    }

    @Test
    fun `fromMap handles empty senders map`() {
        val map = mapOf<String, Any?>("senders" to emptyMap<String, Any>())
        val entry = GiftWallEntry.fromMap(map, "g1")
        assertTrue(entry.senders.isEmpty())
    }

    @Test
    fun `fromMap handles null senders`() {
        val map = mapOf<String, Any?>("senders" to null)
        val entry = GiftWallEntry.fromMap(map, "g1")
        assertTrue(entry.senders.isEmpty())
    }

    // ── GiftSender data class ───────────────────────────────────────

    @Test
    fun `GiftSender stores properties correctly`() {
        val sender = GiftSender(userId = "u1", count = 5)
        assertEquals("u1", sender.userId)
        assertEquals(5, sender.count)
    }

    @Test
    fun `GiftSender default constructor`() {
        val sender = GiftSender()
        assertEquals("", sender.userId)
        assertEquals(0, sender.count)
    }

    // ── GiftRankEntry data class ────────────────────────────────────

    @Test
    fun `GiftRankEntry stores properties correctly`() {
        val entry =
            GiftRankEntry(
                userId = "u1",
                count = 100,
                displayName = "Alice",
                profilePhotoUrl = "photo.png",
            )
        assertEquals("u1", entry.userId)
        assertEquals(100, entry.count)
        assertEquals("Alice", entry.displayName)
        assertEquals("photo.png", entry.profilePhotoUrl)
    }

    @Test
    fun `GiftRankEntry default constructor`() {
        val entry = GiftRankEntry()
        assertEquals("", entry.userId)
        assertEquals(0, entry.count)
        assertEquals("", entry.displayName)
        assertNull(entry.profilePhotoUrl)
    }
}
