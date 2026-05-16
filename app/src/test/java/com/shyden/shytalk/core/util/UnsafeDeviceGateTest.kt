package com.shyden.shytalk.core.util

import io.mockk.every
import io.mockk.mockkObject
import io.mockk.unmockkObject
import org.junit.After
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Behavioural pins for the build-flavor anti-emulator / anti-root gate.
 *
 * The wrapper exists so this contract is testable without mocking BuildConfig
 * (which is const-folded by the Kotlin compiler). Tests inject the bypass
 * flag explicitly via the named parameter.
 *
 * Matrix verified:
 *  - bypass=true  + checker says unsafe → NOT blocked (dev/local/any-debug)
 *  - bypass=false + checker says unsafe → BLOCKED   (prod release)
 *  - bypass=true  + checker says safe   → NOT blocked
 *  - bypass=false + checker says safe   → NOT blocked
 *  - default arg path reads BuildConfig.BYPASS_EMULATOR_GATE
 */
class UnsafeDeviceGateTest {
    @After
    fun tearDown() {
        unmockkObject(DeviceSecurityChecker)
    }

    @Test
    fun `isBlocked returns false when bypass=true and device is unsafe`() {
        mockkObject(DeviceSecurityChecker)
        every { DeviceSecurityChecker.isUnsafe() } returns true

        assertFalse(
            "Dev/local/debug builds must NOT block even when the device is rooted/emulated",
            UnsafeDeviceGate.isBlocked(bypassEmulatorGate = true),
        )
    }

    @Test
    fun `isBlocked returns true when bypass=false and device is unsafe`() {
        mockkObject(DeviceSecurityChecker)
        every { DeviceSecurityChecker.isUnsafe() } returns true

        assertTrue(
            "Prod release builds MUST block rooted/emulated devices",
            UnsafeDeviceGate.isBlocked(bypassEmulatorGate = false),
        )
    }

    @Test
    fun `isBlocked returns false when bypass=true and device is safe`() {
        mockkObject(DeviceSecurityChecker)
        every { DeviceSecurityChecker.isUnsafe() } returns false

        assertFalse(UnsafeDeviceGate.isBlocked(bypassEmulatorGate = true))
    }

    @Test
    fun `isBlocked returns false when bypass=false and device is safe`() {
        mockkObject(DeviceSecurityChecker)
        every { DeviceSecurityChecker.isUnsafe() } returns false

        assertFalse(UnsafeDeviceGate.isBlocked(bypassEmulatorGate = false))
    }

    @Test
    fun `isBlocked default-arg path does not crash and respects checker on clean JVM`() {
        // No mocking — runs against the real DeviceSecurityChecker which, on
        // a clean JVM test environment, returns false for all checks. We
        // assert only that the call resolves without throwing and the
        // result is consistent with the JVM checker behavior. Whether the
        // gate is bypassed depends on the test variant's BuildConfig
        // (devDebug/prodDebug etc.), so we don't assert a specific bool.
        val result = UnsafeDeviceGate.isBlocked()
        // Clean JVM is never unsafe per DeviceSecurityCheckerTest, so the
        // gate must NEVER block here regardless of the bypass flag value.
        assertFalse(
            "Clean JVM test env must never trigger the gate",
            result,
        )
    }
}
