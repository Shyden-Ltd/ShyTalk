package com.shyden.shytalk.core.util

import androidx.compose.runtime.Composable

/**
 * Platform-specific effect that prevents screenshots and screen recording
 * while the composable is in the composition.
 *
 * Android: sets FLAG_SECURE on the window.
 * iOS/JVM: no-op (iOS uses a different mechanism at the app level).
 */
@Composable
expect fun SecureScreenEffect()
