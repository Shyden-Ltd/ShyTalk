package com.shyden.shytalk.core.util

import com.shyden.shytalk.BuildConfig

/**
 * Thin wrapper around [DeviceSecurityChecker.isUnsafe] that respects the
 * build-flavor `BYPASS_EMULATOR_GATE` flag.
 *
 * The flag is set per flavor in `app/build.gradle.kts`:
 *   - prod = false (gate enforced; this is the only flavor that ships to real users)
 *   - dev  = true  (autonomous QA + manual testers can use the Android emulator)
 *   - local = true (Firebase-emulator stack also needs to support emulator clients)
 *   - any *-debug build (devDebug, prodDebug, localDebug) = true (debugger ergonomics)
 *
 * Existing as a testable wrapper, not a one-liner inside MainActivity, so
 * we can assert the bypass behavior without mocking BuildConfig (which is
 * a const-folded field).
 */
object UnsafeDeviceGate {
    /**
     * Returns true if the device should be blocked at startup.
     *
     * @param bypassEmulatorGate test-injected override. Defaults to the
     *   BuildConfig flag. Tests pass `true`/`false` explicitly.
     */
    fun isBlocked(bypassEmulatorGate: Boolean = BuildConfig.BYPASS_EMULATOR_GATE): Boolean {
        if (bypassEmulatorGate) return false
        return DeviceSecurityChecker.isUnsafe()
    }
}
