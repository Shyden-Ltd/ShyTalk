package com.shyden.shytalk.feature.gacha

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SpinTierTest {

    @Test
    fun `buildSpinTiers returns three tiers`() {
        val tiers = buildSpinTiers(emptyMap())
        assertEquals(3, tiers.size)
    }

    @Test
    fun `buildSpinTiers uses default costs when map is empty`() {
        val tiers = buildSpinTiers(emptyMap())
        assertEquals(10, tiers[0].cost)
        assertEquals(100, tiers[1].cost)
        assertEquals(1000, tiers[2].cost)
    }

    @Test
    fun `buildSpinTiers uses custom costs from map`() {
        val costs = mapOf(1 to 15, 10 to 120, 100 to 1100)
        val tiers = buildSpinTiers(costs)
        assertEquals(15, tiers[0].cost)
        assertEquals(120, tiers[1].cost)
        assertEquals(1100, tiers[2].cost)
    }

    @Test
    fun `buildSpinTiers partial map uses defaults for missing`() {
        val costs = mapOf(10 to 200)
        val tiers = buildSpinTiers(costs)
        assertEquals(10, tiers[0].cost)    // default
        assertEquals(200, tiers[1].cost)   // custom
        assertEquals(1000, tiers[2].cost)  // default
    }

    @Test
    fun `buildSpinTiers tier labels are correct`() {
        val tiers = buildSpinTiers(emptyMap())
        assertEquals("1x", tiers[0].label)
        assertEquals("10x", tiers[1].label)
        assertEquals("100x", tiers[2].label)
    }

    @Test
    fun `buildSpinTiers tier counts are correct`() {
        val tiers = buildSpinTiers(emptyMap())
        assertEquals(1, tiers[0].count)
        assertEquals(10, tiers[1].count)
        assertEquals(100, tiers[2].count)
    }

    @Test
    fun `only 100x tier has boostedDrop`() {
        val tiers = buildSpinTiers(emptyMap())
        assertFalse(tiers[0].boostedDrop)
        assertFalse(tiers[1].boostedDrop)
        assertTrue(tiers[2].boostedDrop)
    }

    @Test
    fun `DefaultSpinTiers matches buildSpinTiers with default costs`() {
        val built = buildSpinTiers(mapOf(1 to 10, 10 to 100, 100 to 1000))
        assertEquals(DefaultSpinTiers.size, built.size)
        for (i in DefaultSpinTiers.indices) {
            assertEquals(DefaultSpinTiers[i].label, built[i].label)
            assertEquals(DefaultSpinTiers[i].count, built[i].count)
            assertEquals(DefaultSpinTiers[i].cost, built[i].cost)
            assertEquals(DefaultSpinTiers[i].boostedDrop, built[i].boostedDrop)
        }
    }

    @Test
    fun `rarityConfigForCoinValue highest tier has highest shake intensity`() {
        val highest = rarityConfigForCoinValue(50000)
        val others = listOf(10, 100, 500, 5000).map { rarityConfigForCoinValue(it) }
        val maxOther = others.maxOf { it.shakeIntensity }
        assertTrue(highest.shakeIntensity > maxOther)
    }

    @Test
    fun `rarityConfigForCoinValue lowest tier has no flash and no shake`() {
        val lowest = rarityConfigForCoinValue(10)
        assertFalse(lowest.flash)
        assertEquals(0f, lowest.shakeIntensity)
    }

    @Test
    fun `rarityConfigForCoinValue burst counts increase with value`() {
        val values = listOf(10, 100, 500, 5000, 50000)
        val burstCounts = values.map { rarityConfigForCoinValue(it).burstCount }
        for (i in 0 until burstCounts.size - 1) {
            assertTrue(
                "burst at ${values[i]} (${burstCounts[i]}) should be < burst at ${values[i+1]} (${burstCounts[i+1]})",
                burstCounts[i] < burstCounts[i + 1]
            )
        }
    }

    @Test
    fun `rarityConfigForCoinValue shake intensity increases with value`() {
        val values = listOf(10, 100, 500, 5000, 50000)
        val shakes = values.map { rarityConfigForCoinValue(it).shakeIntensity }
        for (i in 0 until shakes.size - 1) {
            assertTrue(
                "shake at ${values[i]} (${shakes[i]}) should be <= shake at ${values[i+1]} (${shakes[i+1]})",
                shakes[i] <= shakes[i + 1]
            )
        }
    }

    @Test
    fun `rarityConfigForCoinValue boundary values are in correct tier`() {
        // Just below each boundary
        assertEquals(rarityConfigForCoinValue(49).burstCount, rarityConfigForCoinValue(10).burstCount)
        assertEquals(rarityConfigForCoinValue(199).burstCount, rarityConfigForCoinValue(50).burstCount)
        assertEquals(rarityConfigForCoinValue(1999).burstCount, rarityConfigForCoinValue(200).burstCount)
        assertEquals(rarityConfigForCoinValue(9999).burstCount, rarityConfigForCoinValue(2000).burstCount)
        // At and above top boundary
        assertEquals(rarityConfigForCoinValue(10000).burstCount, rarityConfigForCoinValue(100000).burstCount)
    }
}
