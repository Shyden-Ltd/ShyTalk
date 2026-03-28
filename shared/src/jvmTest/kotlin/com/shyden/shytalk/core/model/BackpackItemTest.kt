package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.currentTimeMillis
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class BackpackItemTest {
    // ── fromMap ─────────────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "quantity" to 5,
                "lastAcquired" to 1705326600000L,
                "expiresAt" to 1705413000000L,
            )

        val item = BackpackItem.fromMap(map, "gift-1")

        assertEquals("gift-1", item.giftId)
        assertEquals(5, item.quantity)
        assertEquals(1705326600000L, item.lastAcquired)
        assertEquals(1705413000000L, item.expiresAt)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val item = BackpackItem.fromMap(emptyMap(), "gift-2")

        assertEquals("gift-2", item.giftId)
        assertEquals(0, item.quantity)
        assertEquals(0L, item.lastAcquired)
        assertEquals(0L, item.expiresAt)
    }

    @Test
    fun `fromMap handles Number types for quantity`() {
        val map = mapOf<String, Any?>("quantity" to 10L)
        val item = BackpackItem.fromMap(map, "g1")
        assertEquals(10, item.quantity)
    }

    @Test
    fun `fromMap handles null lastAcquired`() {
        val map = mapOf<String, Any?>("lastAcquired" to null)
        val item = BackpackItem.fromMap(map, "g1")
        assertEquals(0L, item.lastAcquired)
    }

    @Test
    fun `fromMap handles null expiresAt`() {
        val map = mapOf<String, Any?>("expiresAt" to null)
        val item = BackpackItem.fromMap(map, "g1")
        assertEquals(0L, item.expiresAt)
    }

    // ── toMap ────────────────────────────────────────────────────────

    @Test
    fun `toMap includes quantity, lastAcquired, expiresAt`() {
        val item =
            BackpackItem(
                giftId = "gift-1",
                quantity = 3,
                lastAcquired = 1705326600000L,
                expiresAt = 1705413000000L,
            )

        val map = item.toMap()

        assertEquals(3, map["quantity"])
        assertEquals(1705326600000L, map["lastAcquired"])
        assertEquals(1705413000000L, map["expiresAt"])
    }

    @Test
    fun `toMap does not include giftId`() {
        val item = BackpackItem(giftId = "gift-1")
        val map = item.toMap()
        assertFalse("giftId" in map)
    }

    // ── roundtrip ───────────────────────────────────────────────────

    @Test
    fun `toMap and fromMap roundtrip preserves data`() {
        val original =
            BackpackItem(
                giftId = "gift-rt",
                quantity = 7,
                lastAcquired = 1705326600000L,
                expiresAt = 1705413000000L,
            )

        val map = original.toMap()
        val restored = BackpackItem.fromMap(map, original.giftId)

        assertEquals(original, restored)
    }

    // ── isExpired ───────────────────────────────────────────────────

    @Test
    fun `isExpired returns false when expiresAt is 0`() {
        val item = BackpackItem(expiresAt = 0)
        assertFalse(item.isExpired)
    }

    @Test
    fun `isExpired returns true when expiresAt is in the past`() {
        val item = BackpackItem(expiresAt = currentTimeMillis() - 1000)
        assertTrue(item.isExpired)
    }

    @Test
    fun `isExpired returns false when expiresAt is in the future`() {
        val item = BackpackItem(expiresAt = currentTimeMillis() + 100_000)
        assertFalse(item.isExpired)
    }

    // ── isExpiring ──────────────────────────────────────────────────

    @Test
    fun `isExpiring returns false when expiresAt is 0`() {
        val item = BackpackItem(expiresAt = 0)
        assertFalse(item.isExpiring)
    }

    @Test
    fun `isExpiring returns true when expiresAt is in the future`() {
        val item = BackpackItem(expiresAt = currentTimeMillis() + 100_000)
        assertTrue(item.isExpiring)
    }

    @Test
    fun `isExpiring returns false when item has already expired`() {
        val item = BackpackItem(expiresAt = currentTimeMillis() - 1000)
        assertFalse(item.isExpiring)
    }

    // ── remainingMs ─────────────────────────────────────────────────

    @Test
    fun `remainingMs returns MAX_VALUE when expiresAt is 0`() {
        val item = BackpackItem(expiresAt = 0)
        assertEquals(Long.MAX_VALUE, item.remainingMs)
    }

    @Test
    fun `remainingMs returns positive value for future expiry`() {
        val item = BackpackItem(expiresAt = currentTimeMillis() + 60_000)
        assertTrue(item.remainingMs > 0, "Expected positive remaining, got ${item.remainingMs}")
    }

    @Test
    fun `remainingMs returns 0 for past expiry`() {
        val item = BackpackItem(expiresAt = currentTimeMillis() - 60_000)
        assertEquals(0L, item.remainingMs)
    }

    @Test
    fun `remainingMs is never negative`() {
        val item = BackpackItem(expiresAt = 1L) // very old timestamp
        assertTrue(item.remainingMs >= 0, "remainingMs should never be negative, got ${item.remainingMs}")
    }
}
