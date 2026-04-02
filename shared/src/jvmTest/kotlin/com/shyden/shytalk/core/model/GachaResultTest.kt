package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class GachaResultTest {
    // ── fromMap basic ───────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "gifts" to
                    listOf(
                        mapOf(
                            "giftId" to "gift-1",
                            "giftName" to "Rose",
                            "coinValue" to 100,
                            "iconUrl" to "https://icon.png",
                        ),
                        mapOf(
                            "giftId" to "gift-2",
                            "giftName" to "Diamond",
                            "coinValue" to 5000,
                            "iconUrl" to "https://diamond.png",
                        ),
                    ),
                "coinsSpent" to 200,
                "newBalance" to 9800L,
                "newPityCounter" to 3,
                "newLuckScore" to 15,
                "priceChanged" to true,
                "currentPullCosts" to mapOf("1" to 100, "10" to 900),
            )

        val result = GachaResult.fromMap(map)

        assertEquals(2, result.gifts.size)
        assertEquals("gift-1", result.gifts[0].giftId)
        assertEquals("Rose", result.gifts[0].giftName)
        assertEquals(100, result.gifts[0].coinValue)
        assertEquals("https://icon.png", result.gifts[0].iconUrl)
        assertEquals("gift-2", result.gifts[1].giftId)
        assertEquals("Diamond", result.gifts[1].giftName)
        assertEquals(5000, result.gifts[1].coinValue)
        assertEquals(200, result.coinsSpent)
        assertEquals(9800L, result.newBalance)
        assertEquals(3, result.newPityCounter)
        assertEquals(15, result.newLuckScore)
        assertTrue(result.priceChanged)
        assertEquals(mapOf(1 to 100, 10 to 900), result.currentPullCosts)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val result = GachaResult.fromMap(emptyMap())

        assertEquals(emptyList(), result.gifts)
        assertEquals(0, result.coinsSpent)
        assertEquals(0L, result.newBalance)
        assertEquals(0, result.newPityCounter)
        assertEquals(0, result.newLuckScore)
        assertFalse(result.priceChanged)
        assertNull(result.currentPullCosts)
    }

    // ── Gift parsing edge cases ─────────────────────────────────────

    @Test
    fun `fromMap handles empty gifts list`() {
        val map = mapOf<String, Any?>("gifts" to emptyList<Any>())
        val result = GachaResult.fromMap(map)
        assertEquals(emptyList(), result.gifts)
    }

    @Test
    fun `fromMap handles null gifts`() {
        val map = mapOf<String, Any?>("gifts" to null)
        val result = GachaResult.fromMap(map)
        assertEquals(emptyList(), result.gifts)
    }

    @Test
    fun `fromMap skips non-map items in gifts list`() {
        val map =
            mapOf<String, Any?>(
                "gifts" to
                    listOf(
                        "not-a-map",
                        mapOf("giftId" to "gift-1", "giftName" to "Rose", "coinValue" to 100, "iconUrl" to "https://icon.png"),
                        42,
                    ),
            )

        val result = GachaResult.fromMap(map)

        assertEquals(1, result.gifts.size)
        assertEquals("gift-1", result.gifts[0].giftId)
    }

    @Test
    fun `fromMap handles gift with missing fields`() {
        val map =
            mapOf<String, Any?>(
                "gifts" to listOf(mapOf<String, Any?>()),
            )

        val result = GachaResult.fromMap(map)

        assertEquals(1, result.gifts.size)
        assertEquals("", result.gifts[0].giftId)
        assertEquals("", result.gifts[0].giftName)
        assertEquals(0, result.gifts[0].coinValue)
        assertEquals("", result.gifts[0].iconUrl)
    }

    // ── Number type coercion ────────────────────────────────────────

    @Test
    fun `fromMap handles Long for Int fields`() {
        val map =
            mapOf<String, Any?>(
                "coinsSpent" to 200L,
                "newPityCounter" to 3L,
                "newLuckScore" to 15L,
            )

        val result = GachaResult.fromMap(map)

        assertEquals(200, result.coinsSpent)
        assertEquals(3, result.newPityCounter)
        assertEquals(15, result.newLuckScore)
    }

    @Test
    fun `fromMap handles Int for newBalance`() {
        val map = mapOf<String, Any?>("newBalance" to 9800)
        val result = GachaResult.fromMap(map)
        assertEquals(9800L, result.newBalance)
    }

    // ── currentPullCosts edge cases ─────────────────────────────────

    @Test
    fun `fromMap handles null currentPullCosts`() {
        val map = mapOf<String, Any?>("currentPullCosts" to null)
        val result = GachaResult.fromMap(map)
        assertNull(result.currentPullCosts)
    }

    @Test
    fun `fromMap handles currentPullCosts with Long values`() {
        val map =
            mapOf<String, Any?>(
                "currentPullCosts" to mapOf("1" to 100L, "10" to 900L),
            )

        val result = GachaResult.fromMap(map)

        assertEquals(mapOf(1 to 100, 10 to 900), result.currentPullCosts)
    }

    // ── Boolean coercion ────────────────────────────────────────────

    @Test
    fun `fromMap handles integer boolean for priceChanged`() {
        val mapTrue = mapOf<String, Any?>("priceChanged" to 1)
        val mapFalse = mapOf<String, Any?>("priceChanged" to 0)

        assertTrue(GachaResult.fromMap(mapTrue).priceChanged)
        assertFalse(GachaResult.fromMap(mapFalse).priceChanged)
    }
}
