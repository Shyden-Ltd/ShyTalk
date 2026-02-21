package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class GachaResultFromMapTest {

    @Test
    fun `fromMap parses complete result`() {
        val map = mapOf<String, Any?>(
            "gifts" to listOf(
                mapOf(
                    "giftId" to "g1",
                    "giftName" to "Rose",
                    "coinValue" to 10L,
                    "iconUrl" to "https://example.com/rose.png"
                )
            ),
            "coinsSpent" to 100L,
            "newBalance" to 900L,
            "newPityCounter" to 1L,
            "newLuckScore" to 5L
        )

        val result = GachaResult.fromMap(map)

        assertEquals(1, result.gifts.size)
        assertEquals("g1", result.gifts[0].giftId)
        assertEquals("Rose", result.gifts[0].giftName)
        assertEquals(10, result.gifts[0].coinValue)
        assertEquals("https://example.com/rose.png", result.gifts[0].iconUrl)
        assertEquals(100, result.coinsSpent)
        assertEquals(900L, result.newBalance)
        assertEquals(1, result.newPityCounter)
        assertEquals(5, result.newLuckScore)
    }

    @Test
    fun `fromMap handles empty gifts list`() {
        val map = mapOf<String, Any?>(
            "gifts" to emptyList<Any>(),
            "coinsSpent" to 0L,
            "newBalance" to 100L,
            "newPityCounter" to 0L,
            "newLuckScore" to 0L
        )

        val result = GachaResult.fromMap(map)

        assertTrue(result.gifts.isEmpty())
    }

    @Test
    fun `fromMap handles null gifts`() {
        val map = mapOf<String, Any?>(
            "gifts" to null,
            "coinsSpent" to 0L,
            "newBalance" to 100L
        )

        val result = GachaResult.fromMap(map)

        assertTrue(result.gifts.isEmpty())
    }

    @Test
    fun `fromMap handles missing fields with defaults`() {
        val map = emptyMap<String, Any?>()

        val result = GachaResult.fromMap(map)

        assertTrue(result.gifts.isEmpty())
        assertEquals(0, result.coinsSpent)
        assertEquals(0L, result.newBalance)
        assertEquals(0, result.newPityCounter)
        assertEquals(0, result.newLuckScore)
    }

    @Test
    fun `fromMap ignores legacy bracket field`() {
        val map = mapOf<String, Any?>(
            "gifts" to listOf(
                mapOf(
                    "giftId" to "g1",
                    "giftName" to "Rose",
                    "bracket" to "COMMON",
                    "coinValue" to 10L
                )
            )
        )

        val result = GachaResult.fromMap(map)

        assertEquals(1, result.gifts.size)
        assertEquals("g1", result.gifts[0].giftId)
        assertEquals(10, result.gifts[0].coinValue)
    }

    @Test
    fun `fromMap handles multi-pull with many gifts`() {
        val gifts = (1..100).map { i ->
            mapOf(
                "giftId" to "g$i",
                "giftName" to "Gift $i",
                "coinValue" to 10L
            )
        }
        val map = mapOf<String, Any?>(
            "gifts" to gifts,
            "coinsSpent" to 1000L,
            "newBalance" to 0L
        )

        val result = GachaResult.fromMap(map)

        assertEquals(100, result.gifts.size)
        assertEquals(1000, result.coinsSpent)
    }

    @Test
    fun `fromMap skips malformed gift entries`() {
        val map = mapOf<String, Any?>(
            "gifts" to listOf(
                mapOf("giftId" to "g1", "giftName" to "Rose"),
                "not a map",
                42,
                null,
                mapOf("giftId" to "g2", "giftName" to "Crown")
            )
        )

        val result = GachaResult.fromMap(map)

        assertEquals(2, result.gifts.size)
        assertEquals("g1", result.gifts[0].giftId)
        assertEquals("g2", result.gifts[1].giftId)
    }

    @Test
    fun `fromMap gift with missing fields uses defaults`() {
        val map = mapOf<String, Any?>(
            "gifts" to listOf(
                mapOf<String, Any?>()  // completely empty gift map
            )
        )

        val result = GachaResult.fromMap(map)

        assertEquals(1, result.gifts.size)
        assertEquals("", result.gifts[0].giftId)
        assertEquals("", result.gifts[0].giftName)
        assertEquals(0, result.gifts[0].coinValue)
        assertEquals("", result.gifts[0].iconUrl)
    }
}
