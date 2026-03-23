package com.shyden.shytalk.ui.theme

import androidx.compose.ui.graphics.Color
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotEquals
import org.junit.Test

class ColorTest {
    @Test
    fun `SpeakingGreen has correct hex value`() {
        assertEquals(Color(0xFF4CAF50), SpeakingGreen)
    }

    @Test
    fun `light theme primary is MD3 purple`() {
        assertEquals(Color(0xFF6750A4), ShyTalkPrimary)
    }

    @Test
    fun `light theme tertiary is MD3 mauve`() {
        assertEquals(Color(0xFF7D5260), ShyTalkTertiary)
    }

    @Test
    fun `dark theme tertiary is pink`() {
        assertEquals(Color(0xFFEFB8C8), ShyTalkTertiaryDark)
    }

    @Test
    fun `dark theme primary container is deep purple`() {
        assertEquals(Color(0xFF4F378B), ShyTalkPrimaryContainerDark)
    }

    @Test
    fun `light and dark primaries are distinct`() {
        assertNotEquals(ShyTalkPrimary, ShyTalkPrimaryDark)
    }
}
