package com.shyden.shytalk.core

/**
 * Shared build-time flags accessible from common code.
 *
 * Set by platform-specific entry points:
 * - Android: from `MainActivity` based on `BuildConfig.FLAVOR == "local"`
 * - iOS: from `KoinHelper.doInitKoin(useEmulators)` based on `#if DEBUG`
 *
 * Used by features that should only appear in local emulator builds (e.g., Dev Sign-In).
 */
object BuildVariant {
    var isLocalEmulator: Boolean = false
}
