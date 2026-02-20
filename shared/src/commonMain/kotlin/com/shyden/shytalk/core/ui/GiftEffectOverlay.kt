package com.shyden.shytalk.core.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Composable
expect fun GiftEffectOverlay(
    animationUrl: String,
    soundUrl: String,
    isVisible: Boolean,
    onFinished: () -> Unit,
    modifier: Modifier = Modifier
)
