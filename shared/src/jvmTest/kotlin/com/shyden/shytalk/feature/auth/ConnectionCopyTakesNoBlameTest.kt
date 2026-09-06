package com.shyden.shytalk.feature.auth

import com.shyden.shytalk.testsupport.RepoSource.repoRoot
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The connection-failure copy must not accept blame ShyTalk has not earned.
 *
 * Operator, 2026-08-25: *"don't say 'if it keeps happening, it is our end'.
 * Don't take the blame for it. It's very unlikely to be us... instead give them
 * some quick tips to help resolve the situation."*
 *
 * Three strings were doing it, on two different screens:
 *
 *   connection_trouble     "...may be your connection, or it may be us"
 *   contact_support_hint   "If it keeps happening, it is our end."
 *   contact_support_help   "This is our problem, not yours."
 *
 * Only the first two were named. Sweeping for the CLASS found the third on
 * DegradedModeScreen — see [[feedback-guard-the-class-not-the-instance]] — and
 * surfacing it is what led the operator to delete that screen outright.
 *
 * Why it matters beyond tone: a person who is told it is our end has been given
 * nothing to do. Almost every real instance of this screen is a device-side
 * network problem — no signal, a captive portal, a VPN — and every one of those
 * is something they can fix in seconds if we say so.
 *
 * This asserts on the ENGLISH source strings, which is where the copy is
 * authored; the translations follow it. Rendered-text assertions live with the
 * journeys. See [[feedback-assert-rendered-text-not-just-tags]].
 */
class ConnectionCopyTakesNoBlameTest {
    private val english: String by lazy {
        File(repoRoot(), "shared/src/commonMain/composeResources/values/strings.xml").readText()
    }

    private fun string(name: String): String {
        val match = Regex("""<string name="$name">(.*?)</string>""", RegexOption.DOT_MATCHES_ALL).find(english)
        return match?.groupValues?.get(1) ?: error("no <string name=\"$name\"> in the English resources")
    }

    /**
     * Phrases that hand the fault to us. Matched case-insensitively against the
     * strings a person sees when something will not connect.
     */
    private val blamePhrases =
        listOf(
            "it is our end",
            "it's our end",
            "our end",
            "our fault",
            "our problem",
            "on our side",
            "or it may be us",
            "it may be us",
            "not yours",
        )

    /**
     * Every string a person can be shown when something will not connect.
     *
     * `contact_support_help` is NOT here, and neither is its screen. I argued
     * for keeping its admission — DegradedModeScreen only rendered when our own
     * server reported `status: "degraded"`, so it was true. The operator
     * overruled that on 2026-08-25 for a business reason rather than a
     * technical one — *"I don't want the public knowing on this screen that we
     * have an issue"* — and then went further: *"we should only have 1 screen,
     * saying that we cannot connect."* The screen and all three of its strings
     * are gone; [OneConnectionFailureScreenTest] holds that line.
     *
     * The honest version of what I wanted lives in SHY-0453: a status page the
     * app can point at, so "check the status" replaces a confession.
     */
    private val connectionFacingStrings =
        listOf(
            "connection_trouble",
            "connection_tips",
            "unable_to_connect",
        )

    @Test
    fun `no connection-failure string accepts the blame`() {
        val offenders =
            connectionFacingStrings.flatMap { key ->
                val text = string(key).lowercase()
                blamePhrases.filter { text.contains(it) }.map { "$key contains \"$it\"" }
            }
        assertEquals(emptyList(), offenders)
    }

    @Test
    fun `the failure states the fact and guesses at no cause`() {
        // Operator, 2026-08-25: "remove the line 'this is usually something on
        // your connection'."
        //
        // The first version of this fix swung from blaming us to blaming them.
        // Both are guesses, and a guess printed as a fact is wrong roughly as
        // often as it is right. The screen says what HAPPENED — we could not
        // reach the servers — and the tips below it say what to try. Neither
        // needs a culprit.
        val text = string("connection_trouble").lowercase()
        val guesses = listOf("your connection", "our end", "usually", "probably", "may be")
        assertEquals(emptyList(), guesses.filter { text.contains(it) }, "connection_trouble: $text")
    }

    @Test
    fun `the tips say device, because ShyTalk is not only on phones`() {
        // Operator, 2026-08-25. A tablet is not a phone, and telling somebody to
        // restart a phone they are not holding is the kind of small wrongness
        // that makes the rest of the advice easy to dismiss.
        val tips = string("connection_tips").lowercase()
        assertTrue(tips.contains("device"), "connection_tips: $tips")
        assertTrue(!tips.contains("phone"), "connection_tips still says phone: $tips")
    }

    @Test
    fun `the person is given something they can actually do`() {
        // The point of removing the blame is not tone, it is ACTION. A screen
        // that says "it is our end" leaves somebody with nothing to try, and
        // almost every real instance of this screen is fixable on the device.
        val tips = string("connection_tips").lowercase()
        val expectedActions = listOf("internet", "vpn", "restart")
        val missing = expectedActions.filterNot { tips.contains(it) }
        assertEquals(emptyList(), missing, "connection_tips must name concrete things to try")
    }

    @Test
    fun `every locale carries the tips, not just English`() {
        // A tip nobody outside English can read is not a tip. Five locales
        // since SHY-0289 (base + id, th, vi, zh). The count is hardcoded on
        // purpose: it is the anchor that makes a zero-file scan impossible,
        // and deriving it from the directory listing would make it agree with
        // whatever it found.
        val resources = File(repoRoot(), "shared/src/commonMain/composeResources")
        val localeDirs = resources.listFiles { f: File -> f.isDirectory && f.name.startsWith("values") } ?: emptyArray()
        assertTrue(localeDirs.size >= 5, "expected at least 5 locale directories, found ${localeDirs.size}")
        val missing =
            localeDirs
                .filterNot { File(it, "strings.xml").readText().contains("""<string name="connection_tips">""") }
                .map { it.name }
                .sorted()
        assertEquals(emptyList(), missing)
    }
}
