package com.shyden.shytalk.core.ui.effects

import org.junit.Assert.assertEquals
import org.junit.Test

class GiftEffectRegistryTest {
    // ===== durationForValue =====

    @Test
    fun `low value duration is 2000ms`() {
        assertEquals(2000L, GiftEffectRegistry.durationForValue(10))
    }

    @Test
    fun `uncommon value duration is 3000ms`() {
        assertEquals(3000L, GiftEffectRegistry.durationForValue(100))
    }

    @Test
    fun `rare value duration is 4000ms`() {
        assertEquals(4000L, GiftEffectRegistry.durationForValue(500))
    }

    @Test
    fun `epic value duration is 5000ms`() {
        assertEquals(5000L, GiftEffectRegistry.durationForValue(5000))
    }

    @Test
    fun `legendary value duration is 7000ms`() {
        assertEquals(7000L, GiftEffectRegistry.durationForValue(50000))
    }

    @Test
    fun `duration increases with coin value`() {
        val values = listOf(10, 100, 500, 5000, 50000)
        val durations = values.map { GiftEffectRegistry.durationForValue(it) }
        assertEquals(durations, durations.sorted())
    }

    @Test
    fun `boundary values produce correct tiers`() {
        // < 50 → 2000
        assertEquals(2000L, GiftEffectRegistry.durationForValue(49))
        // 50..199 → 3000
        assertEquals(3000L, GiftEffectRegistry.durationForValue(50))
        assertEquals(3000L, GiftEffectRegistry.durationForValue(199))
        // 200..1999 → 4000
        assertEquals(4000L, GiftEffectRegistry.durationForValue(200))
        assertEquals(4000L, GiftEffectRegistry.durationForValue(1999))
        // 2000..9999 → 5000
        assertEquals(5000L, GiftEffectRegistry.durationForValue(2000))
        assertEquals(5000L, GiftEffectRegistry.durationForValue(9999))
        // >= 10000 → 7000
        assertEquals(7000L, GiftEffectRegistry.durationForValue(10000))
    }

    // ===== coinValueForGiftId =====

    @Test
    fun `common gifts return low coin value`() {
        val commonIds = listOf("rose", "heart", "thumbs_up", "star", "smiley", "coffee", "candy", "balloon")
        for (id in commonIds) {
            assertEquals("$id should be 10", 10, GiftEffectRegistry.coinValueForGiftId(id))
        }
    }

    @Test
    fun `uncommon gifts return medium coin value`() {
        val uncommonIds = listOf("teddy_bear", "perfume", "diamond_ring", "bouquet", "fireworks", "music_box")
        for (id in uncommonIds) {
            assertEquals("$id should be 100", 100, GiftEffectRegistry.coinValueForGiftId(id))
        }
    }

    @Test
    fun `rare gifts return 500 coin value`() {
        val rareIds = listOf("treasure_chest", "crown", "sports_car", "yacht", "dragon", "phoenix")
        for (id in rareIds) {
            assertEquals("$id should be 500", 500, GiftEffectRegistry.coinValueForGiftId(id))
        }
    }

    @Test
    fun `epic gifts return 5000 coin value`() {
        val epicIds = listOf("crystal_ball", "castle", "spaceship", "aurora", "galaxy_unicorn")
        for (id in epicIds) {
            assertEquals("$id should be 5000", 5000, GiftEffectRegistry.coinValueForGiftId(id))
        }
    }

    @Test
    fun `legendary gifts return 50000 coin value`() {
        val legendaryIds = listOf("shytalk_emblem", "celestial_throne")
        for (id in legendaryIds) {
            assertEquals("$id should be 50000", 50000, GiftEffectRegistry.coinValueForGiftId(id))
        }
    }

    @Test
    fun `unknown gift ID defaults to 0`() {
        assertEquals(0, GiftEffectRegistry.coinValueForGiftId("nonexistent"))
        assertEquals(0, GiftEffectRegistry.coinValueForGiftId(""))
        assertEquals(0, GiftEffectRegistry.coinValueForGiftId("some_random_gift"))
    }

    @Test
    fun `all 27 known gift IDs are mapped`() {
        val allIds =
            listOf(
                "rose",
                "heart",
                "thumbs_up",
                "star",
                "smiley",
                "coffee",
                "candy",
                "balloon",
                "teddy_bear",
                "perfume",
                "diamond_ring",
                "bouquet",
                "fireworks",
                "music_box",
                "treasure_chest",
                "crown",
                "sports_car",
                "yacht",
                "dragon",
                "phoenix",
                "crystal_ball",
                "castle",
                "spaceship",
                "aurora",
                "galaxy_unicorn",
                "shytalk_emblem",
                "celestial_throne",
            )
        assertEquals(27, allIds.size)
        for (id in allIds) {
            val coinValue = GiftEffectRegistry.coinValueForGiftId(id)
            assert(coinValue > 0) { "$id should have a non-zero coin value" }
        }
    }
}
