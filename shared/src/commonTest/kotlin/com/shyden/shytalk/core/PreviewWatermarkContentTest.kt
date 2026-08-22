package com.shyden.shytalk.core

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * The device badge's own choice of [WatermarkVerbosity] (SHY-0430).
 *
 * `WatermarkFormatTest` proves the FORMATTER renders COMPACT correctly.
 * It cannot prove the badge ASKS for it — flip one argument in
 * [assembleContent] back to FULL and every one of those tests still
 * passes while the badge grows back over the app's copy. This suite is
 * the caller-side half of that seam.
 *
 * Koin is not started under jvmTest, so [assembleContent]'s repository
 * lookup returns null and every signed-in slot is absent. That is the
 * IDLE shape — the smallest FULL can ever be — which makes this the
 * strictest possible place to assert: if COMPACT is not distinguishable
 * from FULL here, it is distinguishable nowhere.
 */
class PreviewWatermarkContentTest {
    @AfterTest
    fun tearDown() {
        QaContext.reset()
    }

    @Test
    fun `the device badge asks for COMPACT`() {
        val content = assembleContent(locale = "en")
        assertEquals(
            WatermarkFormat.MAX_LINES_COMPACT,
            2 + content.detailLines.size,
            "badge rendered ${2 + content.detailLines.size} lines: ${content.detailLines}",
        )
    }

    @Test
    fun `a running journey does not reopen the badge`() {
        // The marker line is FULL-only. Setting one is the nearest thing
        // to a producer this codebase has, and it must not add a line.
        QaContext.setJourneyMarker("j38 s10")
        val content = assembleContent(locale = "en")
        assertFalse(content.detailLines.any { it.contains('▶') }, "lines: ${content.detailLines}")
        assertEquals(WatermarkFormat.MAX_LINES_COMPACT, 2 + content.detailLines.size)
    }

    @Test
    fun `a known route does not reopen the badge`() {
        QaContext.setCurrentRoute("support/{source}")
        val content = assembleContent(locale = "en")
        assertFalse(content.detailLines.any { it.contains("support") }, "lines: ${content.detailLines}")
        assertEquals(WatermarkFormat.MAX_LINES_COMPACT, 2 + content.detailLines.size)
    }

    @Test
    fun `the badge still names the build it is running`() {
        // The whole reason COMPACT keeps a third line. Losing this would
        // make the frame unable to say which binary produced it.
        val content = assembleContent(locale = "en")
        assertEquals(1, content.detailLines.size)
        assertTrue(content.detailLines.single().isNotBlank())
        assertTrue(content.title == "ShyTalk Preview")
    }

    @Test
    fun `the badge never carries the signed-in account`() {
        QaContext.setCurrentRoute("main")
        val lines = assembleContent(locale = "en").detailLines
        assertFalse(lines.any { it.startsWith("UID:") }, "lines: $lines")
        assertFalse(lines.any { it.startsWith("Name:") }, "lines: $lines")
    }
}
