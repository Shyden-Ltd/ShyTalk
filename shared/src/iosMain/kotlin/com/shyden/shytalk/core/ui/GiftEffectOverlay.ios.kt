package com.shyden.shytalk.core.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Composable
actual fun GiftEffectOverlay(
    animationUrl: String,
    soundUrl: String,
    isVisible: Boolean,
    onFinished: () -> Unit,
    modifier: Modifier
) {
    // TODO: Implement iOS Lottie playback
    // For now, auto-dismiss after a delay
    if (isVisible) {
        androidx.compose.runtime.LaunchedEffect(Unit) {
            kotlinx.coroutines.delay(2000)
            onFinished()
        }
    }
}
