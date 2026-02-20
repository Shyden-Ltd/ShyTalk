package com.shyden.shytalk.feature.gacha

import androidx.compose.ui.graphics.Color
import com.shyden.shytalk.core.model.GiftBracket

data class SpinTier(
    val label: String,
    val count: Int,
    val cost: Int,
    val boostedDrop: Boolean,
    val color: Color,
    val accentColor: Color
)

val SpinTiers = listOf(
    SpinTier("1x", 1, 10, false, Color(0xFFFFD700), Color(0xFFFF9100)),
    SpinTier("10x", 10, 100, false, Color(0xFF2979FF), Color(0xFF00B0FF)),
    SpinTier("100x", 100, 1000, true, Color(0xFFD500F9), Color(0xFFE040FB))
)

data class RarityConfig(
    val glowColor: Color,
    val burstCount: Int,
    val shakeIntensity: Float,
    val flash: Boolean,
    val title: String
)

val RarityConfigs = mapOf(
    GiftBracket.COMMON to RarityConfig(
        glowColor = Color.White,
        burstCount = 40,
        shakeIntensity = 0f,
        flash = false,
        title = "You Won!"
    ),
    GiftBracket.UNCOMMON to RarityConfig(
        glowColor = Color(0xFF2979FF),
        burstCount = 70,
        shakeIntensity = 3f,
        flash = false,
        title = "Nice Win!"
    ),
    GiftBracket.RARE to RarityConfig(
        glowColor = Color(0xFFFFD700),
        burstCount = 130,
        shakeIntensity = 5f,
        flash = true,
        title = "RARE WIN!"
    ),
    GiftBracket.EPIC to RarityConfig(
        glowColor = Color(0xFFD500F9),
        burstCount = 180,
        shakeIntensity = 7f,
        flash = true,
        title = "EPIC WIN!"
    ),
    GiftBracket.LEGENDARY to RarityConfig(
        glowColor = Color(0xFFFF1744),
        burstCount = 220,
        shakeIntensity = 10f,
        flash = true,
        title = "LEGENDARY!!"
    )
)
