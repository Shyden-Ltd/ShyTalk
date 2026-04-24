package com.shyden.shytalk.core.effects

import androidx.compose.runtime.Composable

/** Platform back-button handler. On Android, intercepts the system back gesture. No-op on iOS. */
@Composable
expect fun PlatformBackHandler(
    enabled: Boolean,
    onBack: () -> Unit,
)
