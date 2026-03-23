package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class BackpackItemFromMapTest {
    @Test
    fun `complete valid map parses correctly`() {
        val map =
            mapOf<String, Any?>(
                "quantity" to 5L,
                "lastAcquired" to 1000L,
                "expiresAt" to 9999999999999L,
            )
        val item = BackpackItem.fromMap(map, "rose")

        assertEquals("rose", item.giftId)
        assertEquals(5, item.quantity)
        assertEquals(1000L, item.lastAcquired)
        assertEquals(9999999999999L, item.expiresAt)
    }

    @Test
    fun `empty map returns defaults`() {
        val item = BackpackItem.fromMap(emptyMap(), "rose")

        assertEquals("rose", item.giftId)
        assertEquals(0, item.quantity)
        assertEquals(0L, item.lastAcquired)
        assertEquals(0L, item.expiresAt)
    }

    @Test
    fun `isExpired returns true when expiresAt is in the past`() {
        val item = BackpackItem(giftId = "rose", quantity = 1, expiresAt = 1L)
        assertTrue(item.isExpired)
    }

    @Test
    fun `isExpired returns false when expiresAt is zero`() {
        val item = BackpackItem(giftId = "rose", quantity = 1, expiresAt = 0)
        assertFalse(item.isExpired)
    }

    @Test
    fun `isExpiring returns true when expiresAt is in the future`() {
        val item = BackpackItem(giftId = "rose", quantity = 1, expiresAt = System.currentTimeMillis() + 60_000)
        assertTrue(item.isExpiring)
    }

    @Test
    fun `isExpiring returns false when expired`() {
        val item = BackpackItem(giftId = "rose", quantity = 1, expiresAt = 1L)
        assertFalse(item.isExpiring)
    }

    @Test
    fun `remainingMs returns MAX_VALUE when no expiration`() {
        val item = BackpackItem(giftId = "rose", quantity = 1, expiresAt = 0)
        assertEquals(Long.MAX_VALUE, item.remainingMs)
    }

    @Test
    fun `remainingMs returns zero when expired`() {
        val item = BackpackItem(giftId = "rose", quantity = 1, expiresAt = 1L)
        assertEquals(0L, item.remainingMs)
    }

    @Test
    fun `toMap round-trip preserves values`() {
        val original = BackpackItem(giftId = "crown", quantity = 3, lastAcquired = 5000L, expiresAt = 9000L)
        val map = original.toMap()

        assertEquals(3, map["quantity"])
        assertEquals(5000L, map["lastAcquired"])
        assertEquals(9000L, map["expiresAt"])
    }

    @Test
    fun `unknown fields are ignored`() {
        val map =
            mapOf<String, Any?>(
                "quantity" to 2L,
                "unknownField" to "value",
                "anotherField" to 42L,
            )
        val item = BackpackItem.fromMap(map, "rose")

        assertEquals(2, item.quantity)
        assertEquals("rose", item.giftId)
    }
}
