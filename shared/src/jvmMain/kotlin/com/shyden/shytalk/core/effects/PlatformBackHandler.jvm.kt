package com.shyden.shytalk.core.effects

import androidx.compose.runtime.Composable

@Composable
actual fun PlatformBackHandler(
    enabled: Boolean,
    onBack: () -> Unit,
) {
    // No-op on JVM (desktop/test target)
}
