package com.shyden.shytalk.util

import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.TimeZone

/**
 * Formatting contract for the watermark's build/install timestamp
 * (SHY-0205). Android derives the value at RUNTIME from
 * `PackageInfo.lastUpdateTime` — install time — because a build-time
 * constant goes stale under gradle's configuration cache while an
 * install always accompanies a fresh build in the QA loop.
 */
class BuiltAtTest {
    @Test
    fun `formats epoch millis as month-day hour-minute in the given zone`() {
        // 2026-07-18 04:40:00 UTC
        val epoch = 1_784_349_600_000L
        assertEquals("07-18 04:40", formatBuiltAt(epoch, TimeZone.getTimeZone("UTC")))
    }

    @Test
    fun `honours non-utc zones so the device-local time is shown`() {
        val epoch = 1_784_349_600_000L
        assertEquals("07-18 11:40", formatBuiltAt(epoch, TimeZone.getTimeZone("Asia/Jakarta")))
    }

    @Test
    fun `zero-pads single-digit fields`() {
        // 2026-01-05 03:07:00 UTC
        val epoch = 1_767_582_420_000L
        assertEquals("01-05 03:07", formatBuiltAt(epoch, TimeZone.getTimeZone("UTC")))
    }
}
