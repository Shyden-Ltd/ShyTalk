package com.shyden.shytalk.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import com.shyden.shytalk.core.model.GiftEvent
import com.shyden.shytalk.core.ui.effects.GiftAnimation
import com.shyden.shytalk.core.ui.effects.GiftEffectRegistry

/**
 * Full-screen gift animation overlay driven by a [GiftEvent].
 * Renders a pure-Compose particle animation (no Lottie).
 * Tap anywhere to dismiss early, or auto-dismisses when the animation finishes.
 */
@Composable
fun GiftEffectOverlay(
    event: GiftEvent,
    onFinished: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val coinValue = GiftEffectRegistry.coinValueForGiftId(event.giftId)
    val durationMs = GiftEffectRegistry.durationForValue(coinValue)

    // Guard against double-firing (tap dismiss + animation timer both call onFinished)
    var dismissed by remember(event) { mutableStateOf(false) }
    val dismiss = {
        if (!dismissed) {
            dismissed = true
            onFinished()
        }
    }

    Box(
        modifier =
            modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.3f))
                .clickable(
                    indication = null,
                    interactionSource = remember { MutableInteractionSource() },
                ) { dismiss() },
    ) {
        GiftAnimation(
            giftId = event.giftId,
            durationMs = durationMs,
            onFinished = dismiss,
            modifier = Modifier.fillMaxSize(),
            eventId = event.eventId,
        )
    }
}

/**
 * Legacy overload: wraps the old Lottie-based API for backward compatibility.
 * Uses GiftEvent-based overlay internally.
 */
@Composable
fun GiftEffectOverlay(
    animationUrl: String,
    soundUrl: String,
    isVisible: Boolean,
    onFinished: () -> Unit,
    modifier: Modifier = Modifier,
    giftId: String = "",
) {
    if (!isVisible) return
    val event = GiftEvent(giftId = giftId)
    GiftEffectOverlay(event = event, onFinished = onFinished, modifier = modifier)
}
