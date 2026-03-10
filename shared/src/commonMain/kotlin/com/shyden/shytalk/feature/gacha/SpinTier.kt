package com.shyden.shytalk.feature.gacha

import androidx.compose.ui.graphics.Color

data class SpinTier(
    val label: String,
    val count: Int,
    val cost: Int,
    val boostedDrop: Boolean,
    val color: Color,
    val accentColor: Color
)

val DefaultSpinTiers = listOf(
    SpinTier("1x", 1, 10, false, Color(0xFFFFD700), Color(0xFFFF9100)),
    SpinTier("10x", 10, 100, false, Color(0xFF2979FF), Color(0xFF00B0FF)),
    SpinTier("100x", 100, 1000, true, Color(0xFFD500F9), Color(0xFFE040FB))
)

fun buildSpinTiers(pullCosts: Map<Int, Int>): List<SpinTier> = listOf(
    SpinTier("1x", 1, pullCosts[1] ?: 10, false, Color(0xFFFFD700), Color(0xFFFF9100)),
    SpinTier("10x", 10, pullCosts[10] ?: 100, false, Color(0xFF2979FF), Color(0xFF00B0FF)),
    SpinTier("100x", 100, pullCosts[100] ?: 1000, true, Color(0xFFD500F9), Color(0xFFE040FB))
)

data class RarityConfig(
    val glowColor: Color,
    val burstCount: Int,
    val shakeIntensity: Float,
    val flash: Boolean
)

/** Coin-value-based celebration configs — effects scale with value. */
fun rarityConfigForCoinValue(coinValue: Int): RarityConfig = when {
    coinValue < 50 -> RarityConfig(
        glowColor = Color.White,
        burstCount = 40,
        shakeIntensity = 0f,
        flash = false
    )
    coinValue < 200 -> RarityConfig(
        glowColor = Color.White,
        burstCount = 70,
        shakeIntensity = 3f,
        flash = false
    )
    coinValue < 2000 -> RarityConfig(
        glowColor = Color.White,
        burstCount = 130,
        shakeIntensity = 5f,
        flash = true
    )
    coinValue < 10000 -> RarityConfig(
        glowColor = Color.White,
        burstCount = 180,
        shakeIntensity = 7f,
        flash = true
    )
    else -> RarityConfig(
        glowColor = Color.White,
        burstCount = 220,
        shakeIntensity = 10f,
        flash = true
    )
}
