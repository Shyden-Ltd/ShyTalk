package com.shyden.shytalk.core

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The device badge's own choice of [WatermarkVerbosity].
 *
 * INVERTED 2026-08-25, operator decision, reversing SHY-0430:
 *
 *   "This is designed on purpose, in case a tester leaks the application.
 *    I need to be able to see easily who it was... All the data that was
 *    dropped, return it."
 *
 * SHY-0430 read the `Name:` line and the account id as a privacy slip and
 * dropped them. They are a LEAK-ATTRIBUTION mark: they are the only thing
 * that identifies whose build a leaked recording came from, and removing
 * them removed that capability. The badge asks for FULL again.
 *
 * Its height is dealt with in the LINE SPACING, not by dropping fields —
 * and explicitly not to keep the badge out of a screenshot or to make a
 * journey assertion easier. Operator, same message: "you need to be able
 * to prove the app is working without affecting the watermark."
 *
 * `WatermarkFormatTest` proves the FORMATTER renders each verbosity. It
 * cannot prove which one the badge ASKS for — flip one argument in
 * [assembleContent] and every one of those tests still passes while the
 * badge silently loses the fields that identify a leaker. This suite is
 * the caller-side half of that seam.
 *
 * Koin is not started under jvmTest, so [assembleContent]'s repository
 * lookup returns null and every signed-in slot is absent. That is the
 * IDLE shape, which is why the assertions below turn on the FULL-only
 * slots that do NOT need a signed-in user: the route and the journey
 * marker. If FULL is not distinguishable from COMPACT here, it is
 * distinguishable nowhere.
 */
class PreviewWatermarkContentTest {
    @AfterTest
    fun tearDown() {
        QaContext.reset()
    }

    @Test
    fun `the device badge asks for FULL`() {
        // More lines than COMPACT could ever render. Asserted as a floor
        // rather than an exact count, because the idle shape has no
        // signed-in slots and the exact number is not the contract — the
        // contract is that the badge is not being trimmed.
        val content = assembleContent(locale = "en")
        val rendered = 2 + content.detailLines.size
        assertTrue(
            rendered > WatermarkFormat.MAX_LINES_COMPACT,
            "badge rendered $rendered lines, COMPACT is ${WatermarkFormat.MAX_LINES_COMPACT}: ${content.detailLines}",
        )
    }

    @Test
    fun `a running journey is named on the badge`() {
        // The marker line is FULL-only, and setting one is the nearest thing
        // to a producer this codebase has. Under COMPACT it was swallowed.
        QaContext.setJourneyMarker("j38 s10")
        val content = assembleContent(locale = "en")
        assertTrue(content.detailLines.any { it.contains('▶') }, "lines: ${content.detailLines}")
    }

    @Test
    fun `the route being viewed is shown`() {
        QaContext.setCurrentRoute("support/{source}")
        val content = assembleContent(locale = "en")
        assertTrue(content.detailLines.any { it.contains("support") }, "lines: ${content.detailLines}")
    }

    @Test
    fun `the badge still names the build it is running`() {
        // The sha is the only evidence of the binary actually INSTALLED —
        // reading git in the worktree proves only what was BUILT.
        //
        // This used to assert `detailLines.size == 2`, which was COMPACT's
        // line count rather than this test's subject. A count is not the
        // contract: the contract is that the build identity is THERE, and it
        // survives the badge growing or shrinking around it.
        val content = assembleContent(locale = "en")
        assertTrue(content.detailLines.isNotEmpty(), "no detail lines at all")
        assertTrue(content.detailLines.none { it.isBlank() }, "lines: ${content.detailLines}")
        assertTrue(
            content.detailLines.any { !it.startsWith("UID:") },
            "only the account line survived, so nothing names the build: ${content.detailLines}",
        )
        assertEquals("ShyTalk Preview", content.title)
    }

    @Test
    fun `the badge keeps the account line the device runner parses`() {
        // `signInAs` and J38's identity step both read `UID: <digits>`
        // straight out of this badge. Koin is absent here so there is no
        // account to name, but the LINE must still be produced — the
        // runner's failure message distinguishes "signed out" from "the
        // overlay is not showing an account id", and it can only do that
        // if the line exists.
        val lines = assembleContent(locale = "en").detailLines
        assertTrue(lines.any { it.startsWith("UID:") }, "lines: $lines")
    }

    @Test
    fun `the badge carries the display name, which is how a leak is attributed`() {
        // INVERTED 2026-08-25. This asserted the opposite, on privacy grounds:
        // a real person's name burned into every frame of a shared recording.
        //
        // That reading was wrong about what the field is FOR. Operator:
        // "This is designed on purpose, in case a tester leaks the
        // application. I need to be able to see easily who it was." A build
        // handed to a tester carries the tester's identity by design, and
        // dropping it removed the only way to trace a leaked recording back.
        //
        // Koin is absent under jvmTest so there is no account to name, which
        // is why this asserts the badge ASKS for the field rather than that a
        // name is rendered: with a display name available, FULL emits it, and
        // WatermarkFormatTest covers that half. What this pins is that the
        // caller has not quietly gone back to a verbosity that drops it.
        QaContext.setCurrentRoute("main")
        val content = assembleContent(locale = "en")
        val rendered = 2 + content.detailLines.size
        assertTrue(
            rendered > WatermarkFormat.MAX_LINES_COMPACT,
            "the badge is trimmed, so a display name could not appear: ${content.detailLines}",
        )
    }
}
