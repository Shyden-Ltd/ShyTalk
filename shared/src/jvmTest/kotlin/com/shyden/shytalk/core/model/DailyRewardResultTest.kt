package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class DailyRewardResultTest {
    // ── fromMap basic ───────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "coinsAwarded" to 150,
                "newStreak" to 7,
                "isMilestone" to true,
                "newBalance" to 5000L,
                "giftId" to "rare-rose",
                "giftQuantity" to 2,
            )

        val result = DailyRewardResult.fromMap(map)

        assertEquals(150, result.coinsAwarded)
        assertEquals(7, result.newStreak)
        assertTrue(result.isMilestone)
        assertEquals(5000L, result.newBalance)
        assertEquals("rare-rose", result.giftId)
        assertEquals(2, result.giftQuantity)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val result = DailyRewardResult.fromMap(emptyMap())

        assertEquals(0, result.coinsAwarded)
        assertEquals(0, result.newStreak)
        assertFalse(result.isMilestone)
        assertEquals(0L, result.newBalance)
        assertNull(result.giftId)
        assertEquals(0, result.giftQuantity)
    }

    // ── Computed properties ─────────────────────────────────────────

    @Test
    fun `isGiftReward returns true when giftId is present`() {
        val result = DailyRewardResult(giftId = "gift-1")
        assertTrue(result.isGiftReward)
    }

    @Test
    fun `isGiftReward returns false when giftId is null`() {
        val result = DailyRewardResult(giftId = null)
        assertFalse(result.isGiftReward)
    }

    // ── Number type coercion ────────────────────────────────────────

    @Test
    fun `fromMap handles Long for Int fields`() {
        val map =
            mapOf<String, Any?>(
                "coinsAwarded" to 150L,
                "newStreak" to 7L,
                "giftQuantity" to 2L,
            )

        val result = DailyRewardResult.fromMap(map)

        assertEquals(150, result.coinsAwarded)
        assertEquals(7, result.newStreak)
        assertEquals(2, result.giftQuantity)
    }

    @Test
    fun `fromMap handles Int for newBalance`() {
        val map = mapOf<String, Any?>("newBalance" to 5000)
        val result = DailyRewardResult.fromMap(map)
        assertEquals(5000L, result.newBalance)
    }

    @Test
    fun `fromMap handles Double for numeric fields`() {
        val map =
            mapOf<String, Any?>(
                "coinsAwarded" to 150.0,
                "newBalance" to 5000.0,
                "giftQuantity" to 2.0,
            )

        val result = DailyRewardResult.fromMap(map)

        assertEquals(150, result.coinsAwarded)
        assertEquals(5000L, result.newBalance)
        assertEquals(2, result.giftQuantity)
    }

    // ── Boolean coercion ────────────────────────────────────────────

    @Test
    fun `fromMap handles integer boolean for isMilestone`() {
        val mapTrue = mapOf<String, Any?>("isMilestone" to 1)
        val mapFalse = mapOf<String, Any?>("isMilestone" to 0)

        assertTrue(DailyRewardResult.fromMap(mapTrue).isMilestone)
        assertFalse(DailyRewardResult.fromMap(mapFalse).isMilestone)
    }

    @Test
    fun `fromMap handles null isMilestone defaults to false`() {
        val map = mapOf<String, Any?>("isMilestone" to null)
        val result = DailyRewardResult.fromMap(map)
        assertFalse(result.isMilestone)
    }
}
