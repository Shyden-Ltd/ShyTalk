package com.shyden.shytalk.core.util

import androidx.compose.runtime.Composable

@Composable
actual fun SecureScreenEffect() {
    // No-op on iOS — screenshot prevention handled at UIWindow level
}
