package com.shyden.shytalk.core

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class BuildVariantTest {
    @AfterTest
    fun resetState() {
        BuildVariant.initLocalEmulator(false)
    }

    @Test
    fun `defaults to false for production safety`() {
        BuildVariant.initLocalEmulator(false)
        assertFalse(BuildVariant.isLocalEmulator)
    }

    @Test
    fun `can be set to true for local emulator builds`() {
        BuildVariant.initLocalEmulator(true)
        assertTrue(BuildVariant.isLocalEmulator)
    }

    @Test
    fun `can be toggled back to false`() {
        BuildVariant.initLocalEmulator(true)
        BuildVariant.initLocalEmulator(false)
        assertFalse(BuildVariant.isLocalEmulator)
    }
}
