package com.shyden.shytalk.core

/**
 * Shared build-time flags accessible from common code.
 *
 * Set exactly once by platform-specific entry points before any UI runs:
 * - Android: from `MainActivity` based on `BuildConfig.FLAVOR == "local"`
 * - iOS: from `KoinHelper.doInitKoin(useEmulators)` based on `#if DEBUG`
 *
 * `@kotlin.concurrent.Volatile` establishes a happens-before edge between the
 * boot-time write on the main thread and Compose-thread reads on iOS, where
 * recomposition can read the flag from a different thread than the one that
 * wrote it. The property setter is private so feature code cannot flip the
 * flag at runtime — initialisation must go through `initLocalEmulator()`.
 */
object BuildVariant {
    @kotlin.concurrent.Volatile
    var isLocalEmulator: Boolean = false
        private set

    /**
     * One-shot initialiser called from platform entry points before UI mounts.
     * Public (rather than `internal`) so the `app` module's MainActivity can
     * invoke it; the named function makes the "set once at boot" contract
     * explicit at every call site.
     */
    fun initLocalEmulator(value: Boolean) {
        isLocalEmulator = value
    }
}
