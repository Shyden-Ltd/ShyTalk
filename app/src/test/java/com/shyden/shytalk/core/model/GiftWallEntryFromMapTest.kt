package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GiftWallEntryFromMapTest {
    @Test
    fun `complete valid map with senders parses correctly`() {
        val map =
            mapOf<String, Any?>(
                "receivedCount" to 10L,
                "senders" to mapOf("user-1" to 5L, "user-2" to 3L),
                "topSenderId" to "user-1",
                "topSenderCount" to 5L,
            )
        val entry = GiftWallEntry.fromMap(map, "rose")

        assertEquals("rose", entry.giftId)
        assertEquals(10, entry.receivedCount)
        assertEquals(2, entry.senders.size)
        assertEquals(5, entry.senders["user-1"])
        assertEquals(3, entry.senders["user-2"])
        assertEquals("user-1", entry.topSenderId)
        assertEquals(5, entry.topSenderCount)
    }

    @Test
    fun `empty map returns defaults`() {
        val entry = GiftWallEntry.fromMap(emptyMap(), "crown")

        assertEquals("crown", entry.giftId)
        assertEquals(0, entry.receivedCount)
        assertTrue(entry.senders.isEmpty())
        assertNull(entry.topSenderId)
        assertEquals(0, entry.topSenderCount)
    }

    @Test
    fun `empty senders map`() {
        val map =
            mapOf<String, Any?>(
                "receivedCount" to 5L,
                "senders" to emptyMap<String, Any>(),
            )
        val entry = GiftWallEntry.fromMap(map, "gift-1")

        assertTrue(entry.senders.isEmpty())
    }

    @Test
    fun `null senders field defaults to empty`() {
        val map =
            mapOf<String, Any?>(
                "receivedCount" to 3L,
                "senders" to null,
            )
        val entry = GiftWallEntry.fromMap(map, "gift-1")

        assertTrue(entry.senders.isEmpty())
    }

    @Test
    fun `missing senders field defaults to empty`() {
        val map =
            mapOf<String, Any?>(
                "receivedCount" to 3L,
            )
        val entry = GiftWallEntry.fromMap(map, "gift-1")

        assertTrue(entry.senders.isEmpty())
    }

    @Test
    fun `invalid senders entries are skipped`() {
        val map =
            mapOf<String, Any?>(
                "senders" to
                    mapOf(
                        "user-1" to 5L, // valid
                        "user-2" to "bad", // invalid value type
                        123 to 3L, // invalid key type
                    ),
            )
        val entry = GiftWallEntry.fromMap(map, "gift-1")

        assertEquals(1, entry.senders.size)
        assertEquals(5, entry.senders["user-1"])
    }

    @Test
    fun `topSenderId null when missing`() {
        val map =
            mapOf<String, Any?>(
                "receivedCount" to 1L,
            )
        val entry = GiftWallEntry.fromMap(map, "gift-1")

        assertNull(entry.topSenderId)
    }
}
