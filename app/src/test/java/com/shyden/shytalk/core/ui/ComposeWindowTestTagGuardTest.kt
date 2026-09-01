package com.shyden.shytalk.core.ui

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * SHY-0462 — a testTag inside a Compose window has to reach uiautomator.
 *
 * A Compose `Dialog`, `AlertDialog`, `ModalBottomSheet`, `DropdownMenu` or
 * `Popup` renders in its OWN window, which does not inherit the
 * `semantics { testTagsAsResourceId = true }` set on MainActivity's root. Every
 * testTag inside stays internal and the uiautomator dump shows
 * `resource-id="android:id/content"` and nothing else — the controls are
 * visibly on screen while the tree says the window is empty.
 *
 * `Modifier.exposeTestTagsToPlatformDumps()` fixes it, and its own docstring
 * says "apply once per Compose window". It was applied in two places and then
 * forgotten, which cost four separate stalls in one day — each looking like a
 * different bug — and three more on 2026-08-30 (the persona-credential dialog,
 * the daily-reward calendar, the overlay-bubble prompt).
 *
 * Sweeping the files without this guard just resets the clock. This is the
 * part that lasts.
 */
class ComposeWindowTestTagGuardTest {
    private val repoRoot =
        File(System.getProperty("user.dir")!!).let { if (it.name == "app") it.parentFile!! else it }

    private val roots =
        listOf(
            File(repoRoot, "shared/src/commonMain"),
            File(repoRoot, "app/src/main"),
        )

    private val windowOpeners =
        Regex("""\b(AlertDialog|ModalBottomSheet|DropdownMenu|Popup|Dialog)\s*\(""")

    private val exposureCalls = Regex("""exposeTestTagsToPlatformDumps\s*\(""")

    private fun kotlinSources() =
        roots.flatMap { root ->
            if (!root.isDirectory) {
                emptyList()
            } else {
                root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
            }
        }

    /** Source lines with imports removed — an import is a mention, not a call. */
    private fun body(src: String) = src.lines().filterNot { it.trimStart().startsWith("import ") }

    @Test
    fun `the scan actually reaches the source tree`() {
        // Without this the whole guard passes vacuously after a move or rename:
        // a scan of nothing finds no violations.
        roots.forEach { assertTrue("missing source root: ${it.path}", it.isDirectory) }
        assertTrue("scanned no Kotlin sources at all", kotlinSources().count() > 100)
    }

    @Test
    fun `the scan finds files that open a Compose window`() {
        val withWindows = kotlinSources().count { windowOpeners.containsMatchIn(it.readText()) }
        assertTrue("found no Compose windows — the pattern has stopped matching", withWindows > 10)
    }

    @Test
    fun `every Compose window that tags a control exposes those tags`() {
        val offenders =
            kotlinSources()
                .filter { file ->
                    val src = file.readText()
                    if (!src.contains("testTag(")) return@filter false

                    // Counts CALLS, one per window — not mentions.
                    //
                    // The first version of this test asked
                    // `src.contains("exposeTestTagsToPlatformDumps")`, and the
                    // IMPORT LINE satisfies that on its own. A file that imported
                    // the helper and never called it passed. Mutation testing is
                    // what found it: removing the modifier from HomeScreen left
                    // this guard green.
                    val lines = body(src)
                    val windows = lines.sumOf { windowOpeners.findAll(it).count() }
                    val exposures = lines.sumOf { exposureCalls.findAll(it).count() }
                    windows > 0 && exposures < windows
                }.map { it.relativeTo(repoRoot).path }
                .sorted()

        assertTrue(
            "These files open a Compose window and tag controls inside it, but do not call " +
                "Modifier.exposeTestTagsToPlatformDumps() once per window. Every testTag in an " +
                "unexposed window is invisible to uiautomator, so a device journey sees " +
                "`android:id/content` and nothing else — the controls are on screen and the tree " +
                "says the window is empty.\n" +
                "Apply the modifier to each window (or, for `Dialog`, to its content root):\n" +
                offenders.joinToString("\n") { "  $it" },
            offenders.isEmpty(),
        )
    }
}
