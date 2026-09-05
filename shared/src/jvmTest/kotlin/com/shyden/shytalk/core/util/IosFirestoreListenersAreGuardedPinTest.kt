package com.shyden.shytalk.core.util

import com.shyden.shytalk.testsupport.RepoSource
import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * SHY-0523 — SHY-0185 guarded ONE of the eighteen iOS Firestore listeners and the
 * next revoked session aborted the iPhone app from another one. The guard is a
 * property of the class, not of a site: every realtime listener in iosMain must
 * go through [guardedSnapshots], and the raw gitlive `.snapshots` may appear only
 * inside the accessor that wraps it. Pinned at the source because the abort only
 * happens on a phone; the device proof is J40 on the iPhone.
 */
class IosFirestoreListenersAreGuardedPinTest {
    private val iosMain = File(RepoSource.repoRoot(), "shared/src/iosMain/kotlin/com/shyden/shytalk")
    private val accessor = File(iosMain, "core/util/GuardedSnapshots.kt")

    /** The raw gitlive member, receiver-qualified or implicit; a declaration (`val snapshots =`, `snapshots:`) is not a use. */
    private val rawSnapshots = Regex("""\bsnapshots\b(?!\s*[:=])""")

    @Test
    fun `the guarded accessor exists and wraps both the document and the query listener`() {
        assertTrue(accessor.isFile, "anchor moved: ${accessor.path}")
        val raw = codeLines(accessor).count { rawSnapshots.containsMatchIn(it.value) }
        assertTrue(raw >= 2, "GuardedSnapshots.kt must wrap the document and the query listeners (found $raw raw uses)")
    }

    @Test
    fun `no iOS repository subscribes to a raw snapshots listener`() {
        val sources = iosMain.walkTopDown().filter { it.isFile && it.extension == "kt" && it != accessor }.toList()
        assertTrue(sources.size > 20, "anchor moved: only ${sources.size} iosMain Kotlin files found")
        val offenders =
            sources.flatMap { file ->
                codeLines(file)
                    .filter { rawSnapshots.containsMatchIn(it.value) }
                    .map { "${file.relativeTo(iosMain)}:${it.index + 1}" }
            }
        assertEquals(
            emptyList(),
            offenders,
            "raw .snapshots listeners — an uncaught listener error aborts the app on Kotlin/Native; use guardedSnapshots",
        )
        val guardedUses = sources.sumOf { file -> codeLines(file).count { it.value.contains(".guardedSnapshots") } }
        assertTrue(guardedUses >= 1, "no repository uses guardedSnapshots, so the guard is dead code")
    }

    /** Source lines with comment lines dropped, so prose that names `.snapshots` does not count; indexes stay 0-based line numbers. */
    private fun codeLines(file: File): List<IndexedValue<String>> =
        file.readLines().withIndex().filterNot { (_, line) ->
            line.trimStart().let { it.startsWith("//") || it.startsWith("*") || it.startsWith("/*") }
        }
}
