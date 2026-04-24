package com.shyden.shytalk.feature.settings

import kotlin.test.Test
import kotlin.test.assertEquals

class AppSettingsScreenHelpersTest {
    // ── censorEmail ──

    @Test
    fun `censorEmail censors middle of local part`() {
        assertEquals("te*t@example.com", censorEmail("test@example.com"))
    }

    @Test
    fun `censorEmail handles 3-char local part without leaking all chars`() {
        assertEquals("a*c@example.com", censorEmail("abc@example.com"))
    }

    @Test
    fun `censorEmail handles short local part (2 chars)`() {
        assertEquals("a*@example.com", censorEmail("ab@example.com"))
    }

    @Test
    fun `censorEmail handles single char local part`() {
        assertEquals("a*@example.com", censorEmail("a@example.com"))
    }

    @Test
    fun `censorEmail handles long local part`() {
        val result = censorEmail("longusername@example.com")
        // First 2 chars + asterisks + last char
        assertEquals("lo*********e@example.com", result)
    }

    @Test
    fun `censorEmail returns input if no @ sign`() {
        assertEquals("noemail", censorEmail("noemail"))
    }

    @Test
    fun `censorEmail handles empty string`() {
        assertEquals("", censorEmail(""))
    }

    // ── formatCacheSize ──

    @Test
    fun `formatCacheSize formats bytes`() {
        assertEquals("500 B", formatCacheSize(500))
    }

    @Test
    fun `formatCacheSize formats kilobytes`() {
        assertEquals("5 KB", formatCacheSize(5 * 1024))
    }

    @Test
    fun `formatCacheSize formats megabytes`() {
        val result = formatCacheSize((2.5 * 1024 * 1024).toLong())
        assertEquals("2.5 MB", result)
    }

    @Test
    fun `formatCacheSize formats zero bytes`() {
        assertEquals("0 B", formatCacheSize(0))
    }

    @Test
    fun `formatCacheSize boundary at 1024 shows KB`() {
        assertEquals("1 KB", formatCacheSize(1024))
    }

    @Test
    fun `formatCacheSize boundary at 1MB shows MB`() {
        assertEquals("1.0 MB", formatCacheSize(1024 * 1024))
    }

    // ── formatTime ──

    @Test
    fun `formatTime pads single digit hour and minute`() {
        assertEquals("01:05", formatTime(1, 5))
    }

    @Test
    fun `formatTime does not pad double digit values`() {
        assertEquals("22:30", formatTime(22, 30))
    }

    @Test
    fun `formatTime handles midnight`() {
        assertEquals("00:00", formatTime(0, 0))
    }
}
