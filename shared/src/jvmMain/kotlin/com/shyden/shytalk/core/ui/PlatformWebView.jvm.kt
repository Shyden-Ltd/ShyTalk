package com.shyden.shytalk.core.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Suppress("ktlint:standard:function-naming")
@Composable
actual fun PlatformWebView(
    url: String,
    modifier: Modifier,
) {
    // No-op for JVM test target
}
