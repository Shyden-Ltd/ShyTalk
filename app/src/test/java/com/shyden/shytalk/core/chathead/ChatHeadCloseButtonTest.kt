package com.shyden.shytalk.core.chathead

import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests the close button hit region logic used in ChatHeadManager.
 * The close button occupies the top-right corner of the bubble overlay.
 */
class ChatHeadCloseButtonTest {
    // Matches ChatHeadManager constants
    private val bubbleSizeDp = 72
    private val closeButtonSizeDp = 20
    private val density = 2.0f // common xxhdpi density

    private val viewWidth = (bubbleSizeDp * density).toInt() // 144px
    private val closeButtonSizePx = (closeButtonSizeDp * density).toInt() // 40px

    /** Returns true if the given local coordinates land on the close button region. */
    private fun isCloseButtonHit(
        x: Float,
        y: Float,
    ): Boolean = x >= viewWidth - closeButtonSizePx && y <= closeButtonSizePx

    @Test
    fun `tap in top-right corner hits close button`() {
        assertTrue(isCloseButtonHit(x = 140f, y = 5f))
    }

    @Test
    fun `tap at exact close button boundary hits close button`() {
        assertTrue(isCloseButtonHit(x = (viewWidth - closeButtonSizePx).toFloat(), y = closeButtonSizePx.toFloat()))
    }

    @Test
    fun `tap in center does not hit close button`() {
        assertFalse(isCloseButtonHit(x = 72f, y = 72f))
    }

    @Test
    fun `tap in top-left does not hit close button`() {
        assertFalse(isCloseButtonHit(x = 5f, y = 5f))
    }

    @Test
    fun `tap in bottom-right does not hit close button`() {
        assertFalse(isCloseButtonHit(x = 140f, y = 140f))
    }

    @Test
    fun `tap just inside left edge of close button hits`() {
        assertTrue(isCloseButtonHit(x = (viewWidth - closeButtonSizePx).toFloat(), y = 20f))
    }

    @Test
    fun `tap just outside left edge of close button misses`() {
        assertFalse(isCloseButtonHit(x = (viewWidth - closeButtonSizePx - 1).toFloat(), y = 20f))
    }

    @Test
    fun `tap just below close button misses`() {
        assertFalse(isCloseButtonHit(x = 140f, y = (closeButtonSizePx + 1).toFloat()))
    }
}
