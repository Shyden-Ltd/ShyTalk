package com.shyden.shytalk.core.effects

import androidx.compose.runtime.Composable

@Composable
actual fun PlatformBackHandler(
    enabled: Boolean,
    onBack: () -> Unit,
) {
    // iOS has no system back button — navigation handled by SwiftUI/navigation bar
}
