package com.shyden.shytalk.core.util

import io.mockk.every
import io.mockk.mockkObject
import io.mockk.unmockkObject
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class DeviceSecurityCheckerTest {

    // In JVM tests without Robolectric, Build fields are empty/default.
    // The checker correctly returns false for all checks in this environment.

    @Test
    fun `isRooted returns false on clean JVM environment`() {
        assertFalse(DeviceSecurityChecker.isRooted())
    }

    @Test
    fun `isEmulator returns false on clean JVM environment`() {
        assertFalse(DeviceSecurityChecker.isEmulator())
    }

    @Test
    fun `isUnsafe returns false when neither rooted nor emulated`() {
        assertFalse(DeviceSecurityChecker.isUnsafe())
    }

    @Test
    fun `isUnsafe returns true when rooted`() {
        mockkObject(DeviceSecurityChecker)
        every { DeviceSecurityChecker.isRooted() } returns true
        every { DeviceSecurityChecker.isEmulator() } returns false
        every { DeviceSecurityChecker.isUnsafe() } answers { callOriginal() }

        assertTrue(DeviceSecurityChecker.isUnsafe())
        unmockkObject(DeviceSecurityChecker)
    }

    @Test
    fun `isUnsafe returns true when emulator`() {
        mockkObject(DeviceSecurityChecker)
        every { DeviceSecurityChecker.isRooted() } returns false
        every { DeviceSecurityChecker.isEmulator() } returns true
        every { DeviceSecurityChecker.isUnsafe() } answers { callOriginal() }

        assertTrue(DeviceSecurityChecker.isUnsafe())
        unmockkObject(DeviceSecurityChecker)
    }

    @Test
    fun `isUnsafe returns true when both rooted and emulator`() {
        mockkObject(DeviceSecurityChecker)
        every { DeviceSecurityChecker.isRooted() } returns true
        every { DeviceSecurityChecker.isEmulator() } returns true
        every { DeviceSecurityChecker.isUnsafe() } answers { callOriginal() }

        assertTrue(DeviceSecurityChecker.isUnsafe())
        unmockkObject(DeviceSecurityChecker)
    }
}
