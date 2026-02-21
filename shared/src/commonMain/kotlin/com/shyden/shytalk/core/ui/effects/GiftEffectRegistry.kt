package com.shyden.shytalk.core.ui.effects

object GiftEffectRegistry {

    /** Duration in ms based on gift coin value tier. */
    fun durationForValue(coinValue: Int): Long = when {
        coinValue < 50 -> 2000L
        coinValue < 200 -> 3000L
        coinValue < 2000 -> 4000L
        coinValue < 10000 -> 5000L
        else -> 7000L
    }

    /** Resolve a coin value for a giftId from the known catalog. Falls back to 0 (common tier). */
    fun coinValueForGiftId(giftId: String): Int = when (giftId) {
        "rose", "heart", "thumbs_up", "star", "smiley", "coffee", "candy", "balloon" -> 10
        "teddy_bear", "perfume", "diamond_ring", "bouquet", "fireworks", "music_box" -> 100
        "treasure_chest", "crown", "sports_car", "yacht", "dragon", "phoenix" -> 500
        "crystal_ball", "castle", "spaceship", "aurora", "galaxy_unicorn" -> 5000
        "shytalk_emblem", "celestial_throne" -> 50000
        else -> 0
    }
}
