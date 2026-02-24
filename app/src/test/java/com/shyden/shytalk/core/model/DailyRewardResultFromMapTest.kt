package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DailyRewardResultFromMapTest {

    @Test
    fun `complete valid map parses correctly`() {
        val map = mapOf<String, Any?>(
            "coinsAwarded" to 100,
            "newStreak" to 7,
            "isMilestone" to true,
            "newBalance" to 500L
        )
        val result = DailyRewardResult.fromMap(map)

        assertEquals(100, result.coinsAwarded)
        assertEquals(7, result.newStreak)
        assertTrue(result.isMilestone)
        assertEquals(500L, result.newBalance)
    }

    @Test
    fun `empty map returns defaults`() {
        val result = DailyRewardResult.fromMap(emptyMap())

        assertEquals(0, result.coinsAwarded)
        assertEquals(0, result.newStreak)
        assertFalse(result.isMilestone)
        assertEquals(0L, result.newBalance)
    }

    @Test
    fun `Long values from Firestore parse correctly`() {
        val map = mapOf<String, Any?>(
            "coinsAwarded" to 50L,
            "newStreak" to 3L,
            "newBalance" to 1000L
        )
        val result = DailyRewardResult.fromMap(map)

        assertEquals(50, result.coinsAwarded)
        assertEquals(3, result.newStreak)
        assertEquals(1000L, result.newBalance)
    }

    @Test
    fun `Int values parse correctly`() {
        val map = mapOf<String, Any?>(
            "coinsAwarded" to 75,
            "newStreak" to 5,
            "newBalance" to 250
        )
        val result = DailyRewardResult.fromMap(map)

        assertEquals(75, result.coinsAwarded)
        assertEquals(5, result.newStreak)
        assertEquals(250L, result.newBalance)
    }

    @Test
    fun `Double values parse correctly`() {
        val map = mapOf<String, Any?>(
            "coinsAwarded" to 50.0,
            "newStreak" to 3.0,
            "newBalance" to 1000.0
        )
        val result = DailyRewardResult.fromMap(map)

        assertEquals(50, result.coinsAwarded)
        assertEquals(3, result.newStreak)
        assertEquals(1000L, result.newBalance)
    }

    @Test
    fun `isMilestone boolean parsing`() {
        val mapTrue = mapOf<String, Any?>("isMilestone" to true)
        val mapFalse = mapOf<String, Any?>("isMilestone" to false)
        val mapMissing = mapOf<String, Any?>("coinsAwarded" to 10)

        assertTrue(DailyRewardResult.fromMap(mapTrue).isMilestone)
        assertFalse(DailyRewardResult.fromMap(mapFalse).isMilestone)
        assertFalse(DailyRewardResult.fromMap(mapMissing).isMilestone)
    }

    @Test
    fun `gift reward fields parse correctly`() {
        val map = mapOf<String, Any?>(
            "coinsAwarded" to 0,
            "newStreak" to 7,
            "isMilestone" to true,
            "newBalance" to 100L,
            "giftId" to "rose",
            "giftQuantity" to 3
        )
        val result = DailyRewardResult.fromMap(map)

        assertEquals("rose", result.giftId)
        assertEquals(3, result.giftQuantity)
        assertTrue(result.isGiftReward)
        assertEquals(0, result.coinsAwarded)
    }

    @Test
    fun `coin reward has no gift fields`() {
        val map = mapOf<String, Any?>(
            "coinsAwarded" to 100,
            "newStreak" to 7,
            "isMilestone" to true,
            "newBalance" to 500L
        )
        val result = DailyRewardResult.fromMap(map)

        assertFalse(result.isGiftReward)
        assertEquals(null, result.giftId)
        assertEquals(0, result.giftQuantity)
    }
}
