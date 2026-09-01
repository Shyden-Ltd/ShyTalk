package com.shyden.shytalk.core.ui

import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.File

/**
 * SHY-0444 — every remote image needs a failure state somebody chose.
 *
 * `AsyncImage` was called in 41 places and not one passed `error`,
 * `placeholder` or `fallback`, so every remote image in the app fell through to
 * Coil's own broken-image state on a dead URL, a CDN outage, a local stack with
 * no object storage, or simply a patchy connection — which is the normal
 * condition on mobile, not an edge case.
 *
 * `RemoteImage` carries the designed failure state. This guard keeps call site
 * 42 from going back to the raw one, because a sweep without a guard just
 * resets the clock.
 */
class RemoteImageGuardTest {
    private val repoRoot =
        File(System.getProperty("user.dir")!!).let { if (it.name == "app") it.parentFile!! else it }

    private val roots =
        listOf(File(repoRoot, "shared/src/commonMain"), File(repoRoot, "app/src/main"))

    /** The one file allowed to call Coil directly — it IS the wrapper. */
    private val wrapper = "shared/src/commonMain/kotlin/com/shyden/shytalk/core/ui/RemoteImage.kt"

    private fun kotlinSources() =
        roots.flatMap { root ->
            if (!root.isDirectory) {
                emptyList()
            } else {
                root.walkTopDown().filter { it.isFile && it.extension == "kt" }.toList()
            }
        }

    @Test
    fun `the scan actually reaches the source tree`() {
        roots.forEach { assertTrue("missing source root: ${it.path}", it.isDirectory) }
        assertTrue("scanned no Kotlin sources at all", kotlinSources().count() > 100)
    }

    @Test
    fun `the wrapper exists and is the one calling Coil`() {
        // Anchors the exemption. If the wrapper is renamed or stops calling
        // AsyncImage, this guard would otherwise pass while protecting nothing.
        val f = File(repoRoot, wrapper)
        assertTrue("RemoteImage.kt is missing at $wrapper", f.isFile)
        assertTrue("RemoteImage no longer calls AsyncImage", f.readText().contains("AsyncImage("))
    }

    @Test
    fun `nothing else calls AsyncImage directly`() {
        val offenders =
            kotlinSources()
                .filter { it.relativeTo(repoRoot).path != wrapper }
                .filter { file ->
                    file.readText().lines().any { line ->
                        !line.trimStart().startsWith("//") &&
                            !line.trimStart().startsWith("*") &&
                            Regex("""\bAsyncImage\s*\(""").containsMatchIn(line)
                    }
                }.map { it.relativeTo(repoRoot).path }
                .sorted()

        assertTrue(
            "These call Coil's AsyncImage directly, so a failed load shows Coil's broken-image " +
                "state rather than one anybody designed. Use RemoteImage, which carries the " +
                "failure state — and pass `error` if the screen has something better to show, " +
                "the way the gift wall shows a gift's initials:\n" +
                offenders.joinToString("\n") { "  $it" },
            offenders.isEmpty(),
        )
    }
}
