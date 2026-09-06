package com.shyden.shytalk.feature.support

import com.shyden.shytalk.testsupport.RepoSource.repoRoot
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * The Support screen's bottom edge, pinned from both sides.
 *
 * Two defects meet here and pull in opposite directions:
 *
 * - **SHY-0428** — Send was drawn under the Android navigation bar, its tappable
 *   centre landing on HOME. Fixed by insetting. So Send MUST be inset.
 * - **SHY-0431** — that inset sat on the Scaffold's own modifier, which shrinks
 *   the background too. Android hides it; iOS left the bottom 34pt black. So the
 *   BACKGROUND must NOT be inset.
 *
 * Undo either and one of them comes back, which is why both are pinned rather
 * than left to a comment. A structural pin, because the thing being asserted is
 * layout on a device this test does not run on — the device evidence is the
 * other half, and this stops the shape drifting between runs.
 */
class SupportPageInsetWiringPinTest {
    private fun source(): String =
        File(
            repoRoot(),
            "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/support/SupportPage.kt",
        ).readText()

    /** Comments quote the modifiers they explain, so they are stripped first. */
    internal fun withoutComments(text: String): String =
        text
            .replace(Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL), "")
            .lines()
            .joinToString("\n") { it.substringBefore("//") }

    @Test
    fun `the file is found and is the Support screen`() {
        assertTrue(source().contains("fun SupportPage("), "SupportPage.kt did not contain SupportPage")
    }

    @Test
    fun `the comment stripper does not hide real code`() {
        // The space before `//` survives, which is why nothing here compares
        // exact strings against source lines.
        assertEquals("val x = 1 \n", withoutComments("val x = 1 // and a note\n"))
        assertEquals("\n", withoutComments("/* a block\n   note */\n"))
    }

    /** SHY-0431: insetting the Scaffold insets its background. */
    @Test
    fun `the Scaffold modifier carries no window inset`() {
        val code = withoutComments(source())
        val scaffoldModifier =
            Regex("""Scaffold\(\s*modifier\s*=\s*([^\n]*)""").find(code)?.groupValues?.get(1)
        assertEquals(
            null,
            scaffoldModifier?.takeIf { it.contains("windowInsetsPadding") },
            "the Scaffold modifier is insetting again -- that paints the black strip back on iOS",
        )
    }

    /** So the body's bottom padding is the bar's height, and only that. */
    @Test
    fun `the Scaffold declares zero content insets, so the body padding is unambiguous`() {
        assertTrue(
            withoutComments(source()).contains("contentWindowInsets = WindowInsets(0)"),
            "without this, the body's bottom padding depends on which Scaffold layout branch runs",
        )
    }

    /** SHY-0428: Send must stay off the navigation bar and the home indicator. */
    @Test
    fun `Send is inset`() {
        val code = withoutComments(source())
        val sendModifier =
            Regex("""windowInsetsPadding\(bottomInset\)[\s\S]{0,200}?testTag\(TAG_SUPPORT_SEND\)""").find(code)
        assertTrue(
            sendModifier != null,
            "Send no longer applies bottomInset before its testTag -- SHY-0428 returns",
        )
    }

    /** The union counts the keyboard and the navigation bar ONCE. */
    @Test
    fun `the inset is defined once, as the union that avoids double counting`() {
        val code = withoutComments(source())
        assertTrue(
            code.contains("val bottomInset = WindowInsets.ime.union(WindowInsets.navigationBars)"),
            "the single inset definition changed shape",
        )
        val unions = Regex("""WindowInsets\.ime\.union\(""").findAll(code).count()
        assertEquals(1, unions, "the inset is defined more than once, so the two can drift apart")
    }

    /**
     * Both branches replace the form and hide the bottom bar, so nothing else is
     * holding them off the home indicator.
     */
    @Test
    fun `every branch that hides the bottom bar insets itself`() {
        val code = withoutComments(source())
        val missing =
            listOf("SentConfirmation(", "DuplicateChoice(")
                .filterNot { call ->
                    Regex(Regex.escape(call) + """[\s\S]{0,200}?windowInsetsPadding\(bottomInset\)""")
                        .containsMatchIn(code)
                }
        assertEquals(emptyList(), missing, "these branches have no bottom bar and no inset of their own")
    }

    @Test
    fun `the bottom bar Surface is not inset, because it is the background`() {
        val code = withoutComments(source())
        val surface = Regex("""Surface\(tonalElevation = 3\.dp\)([^\n]*)""").find(code)?.groupValues?.get(1)
        assertTrue(surface != null, "the bottom bar Surface was renamed or removed")
        assertEquals(
            null,
            surface.takeIf { it.contains("windowInsetsPadding") },
            "insetting the Surface leaves the unpainted strip this ticket removed",
        )
    }
}
