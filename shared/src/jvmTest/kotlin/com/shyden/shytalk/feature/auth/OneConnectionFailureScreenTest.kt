package com.shyden.shytalk.feature.auth

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * There is exactly ONE screen for "we cannot connect", and it never takes blame.
 *
 * Operator, 2026-08-25: *"that screen should be gone already... we should only
 * have 1 screen, saying that we cannot connect. In that screen we should never
 * take blame."*
 *
 * There were two. `SignInScreen`'s "Unable to Connect" panel, and
 * `DegradedModeScreen` — a full-screen interstitial shown whenever
 * `/api/health` answered `status: "degraded"`, announcing "Technical
 * Difficulties" and "This is our problem, not yours" before anybody could get
 * in. Two screens for one situation is two places for the copy to drift, and
 * the second one published an outage to the public.
 *
 * Degraded is not the same as unreachable, and it does not need a screen: the
 * app still works, and `DegradedModeBanner` already says so in a line rather
 * than a wall. A screen that stops somebody getting in should be reserved for
 * actually not being able to get in.
 *
 * A source-level guard, deliberately. The thing being defended is that the
 * screen does not come BACK — a behavioural test can only assert about code
 * that exists. See [[feedback-source-scanning-guards-need-their-own-anchors]].
 */
class OneConnectionFailureScreenTest {
    private fun repoRoot(): File {
        var dir = File(System.getProperty("user.dir"))
        while (!File(dir, "settings.gradle.kts").exists() && dir.parentFile != null) dir = dir.parentFile
        return dir
    }

    @Test
    fun `the degraded-mode screen is gone`() {
        val screen = File(repoRoot(), "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/update/DegradedModeScreen.kt")
        assertTrue(!screen.exists(), "DegradedModeScreen.kt is back at ${screen.path}")
    }

    @Test
    fun `nothing renders a second connection-failure screen`() {
        // Anchored on the composable NAME rather than the file, because a
        // rename would move the file and leave the screen.
        val sources =
            listOf(
                "app/src/main/java/com/shyden/shytalk/MainActivity.kt",
                "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/update",
            ).map { File(repoRoot(), it) }
        val offenders =
            sources.flatMap { path ->
                val files = if (path.isDirectory) path.walkTopDown().filter { it.extension == "kt" }.toList() else listOf(path)
                files.filter { it.exists() && it.readText().contains("DegradedModeScreen") }.map { it.name }
            }
        assertEquals(emptyList(), offenders)
    }

    @Test
    fun `its copy is gone from every locale`() {
        // Strings outlive the screens that used them, and an orphan is how a
        // deleted screen quietly comes back: the copy is still there to render.
        val resources = File(repoRoot(), "shared/src/commonMain/composeResources")
        val retired = listOf("technical_difficulties", "technical_difficulties_description", "contact_support_help")
        val localeDirs = resources.listFiles { f: File -> f.isDirectory && f.name.startsWith("values") } ?: emptyArray()
        // Five since SHY-0289; hardcoded so a zero-file scan cannot pass.
        assertTrue(localeDirs.size >= 5, "expected at least 5 locales, found ${localeDirs.size}")
        val offenders =
            localeDirs
                .flatMap { dir ->
                    val text = File(dir, "strings.xml").readText()
                    retired.filter { text.contains("""<string name="$it">""") }.map { "${dir.name}/$it" }
                }.sorted()
        assertEquals(emptyList(), offenders)
    }
}
