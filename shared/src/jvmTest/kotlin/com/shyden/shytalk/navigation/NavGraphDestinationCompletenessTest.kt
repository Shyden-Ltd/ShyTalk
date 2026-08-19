package com.shyden.shytalk.navigation

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Whole-graph invariant: a nav graph MUST register every destination it
 * navigates to.
 *
 * SHY-0268 — ShyTalk carries two coexisting nav graphs (SHY-0024 tracks
 * collapsing them): [SharedNavGraph] drives iOS, `app/.../NavGraph.kt`
 * drives Android (MainActivity mounts `NavGraph(...)`, never the shared
 * one). The Gacha 18+ gate shipped its `navigate(Screen
 * .AgeVerificationSubmit.route)` call into BOTH graphs but registered the
 * destination in the shared one only. Navigation-Compose throws
 * `IllegalArgumentException` for an unknown route, uncaught on the main
 * thread — so tapping "Verify now" killed the Android process outright.
 *
 * Pinning only that one route would leave the DOOR open: every future
 * destination added to one graph and not the other reproduces the same
 * crash. So this reads the real sources and asserts the invariant over
 * the WHOLE graph — navigated ⊆ registered — for both graphs at once.
 *
 * Known limitation: raw source parsing, not AST-aware. Comments are
 * stripped first (a commented-out `navigate(...)` must not manufacture a
 * failure), but string-literal routes and indirection through a helper
 * that itself calls `navigate(...)` are only caught because the helper
 * body lives in the same file. Device journeys are the semantic backstop.
 */
class NavGraphDestinationCompletenessTest {
    private fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            if (File(dir, "settings.gradle.kts").exists()) return dir
            dir = dir.parentFile
        }
        error("repo root (settings.gradle.kts) not found from ${System.getProperty("user.dir")}")
    }

    /** Source with `//` line comments and block comments removed. */
    private fun readStripped(relative: String): String {
        val f = File(repoRoot(), relative)
        assertTrue(f.exists(), "expected source file to exist: $relative")
        return f
            .readText()
            .replace(BLOCK_COMMENT, "")
            .lines()
            .joinToString("\n") { it.substringBefore("//") }
    }

    /**
     * Destinations the graph declares, i.e. `composable(Screen.X.route)`
     * and the multi-line `composable(\n route = Screen.X.route,` form.
     */
    private fun registeredDestinations(src: String): Set<String> = REGISTRATION.findAll(src).map { it.groupValues[1] }.toSet()

    /**
     * Destinations the graph asks the NavController to go to, via either
     * `navigate(Screen.X.route)` or `navigate(Screen.X.createRoute(...))`.
     */
    private fun navigatedDestinations(src: String): Set<String> = NAVIGATION.findAll(src).map { it.groupValues[1] }.toSet()

    private fun assertGraphIsComplete(relative: String) {
        val src = readStripped(relative)
        val registered = registeredDestinations(src)
        val navigated = navigatedDestinations(src)

        // Guard the parser itself: a regex that silently matches nothing
        // would make this test vacuously green forever.
        assertTrue(
            registered.size >= MIN_EXPECTED_DESTINATIONS,
            "parser found only ${registered.size} registered destinations in $relative — " +
                "the extraction regex has drifted from the source format",
        )
        assertTrue(
            navigated.size >= MIN_EXPECTED_DESTINATIONS,
            "parser found only ${navigated.size} navigate() targets in $relative — " +
                "the extraction regex has drifted from the source format",
        )

        val unregistered = (navigated - registered).sorted()
        assertEquals(
            emptyList(),
            unregistered,
            "$relative navigates to destination(s) it never registers: $unregistered. " +
                "NavController.navigate() throws IllegalArgumentException for an unknown " +
                "route and the app dies. Add a composable(Screen.<X>.route) { } entry to " +
                "this graph (SHY-0268).",
        )
    }

    @Test
    fun `android nav graph registers every destination it navigates to`() {
        assertGraphIsComplete(ANDROID_NAV_GRAPH)
    }

    @Test
    fun `shared nav graph registers every destination it navigates to`() {
        assertGraphIsComplete(SHARED_NAV_GRAPH)
    }

    @Test
    fun `android nav graph registers the age verification submit destination`() {
        val src = readStripped(ANDROID_NAV_GRAPH)
        assertTrue(
            "AgeVerificationSubmit" in registeredDestinations(src),
            "$ANDROID_NAV_GRAPH must register Screen.AgeVerificationSubmit — the Gacha and DM " +
                "18+ gates navigate to it, and Android crashed on the missing destination (SHY-0268)",
        )
    }

    @Test
    fun `shared nav graph registers the age verification submit destination`() {
        val src = readStripped(SHARED_NAV_GRAPH)
        assertTrue(
            "AgeVerificationSubmit" in registeredDestinations(src),
            "$SHARED_NAV_GRAPH must register Screen.AgeVerificationSubmit (iOS parity, SHY-0268)",
        )
    }

    @Test
    fun `both graphs register the same set of destinations`() {
        val android = registeredDestinations(readStripped(ANDROID_NAV_GRAPH))
        val shared = registeredDestinations(readStripped(SHARED_NAV_GRAPH))
        // Not an equality assertion: the shared graph legitimately owns
        // Compose-Multiplatform-only destinations the Android graph
        // routes to natively. Only the gated 18+ surfaces must match, so
        // a destination behind an age gate can never be iOS-only again.
        val ageGated = setOf("AgeVerificationSubmit", "RequiredDOB")
        assertEquals(
            ageGated intersect shared,
            ageGated intersect android,
            "age-gated destinations must exist in BOTH nav graphs — a gate whose CTA " +
                "resolves on one platform only is a crash on the other (SHY-0268)",
        )
    }

    private companion object {
        const val ANDROID_NAV_GRAPH = "app/src/main/java/com/shyden/shytalk/navigation/NavGraph.kt"
        const val SHARED_NAV_GRAPH = "shared/src/commonMain/kotlin/com/shyden/shytalk/navigation/SharedNavGraph.kt"

        /** Both graphs are large; a parse yielding fewer than this has broken. */
        const val MIN_EXPECTED_DESTINATIONS = 20

        val BLOCK_COMMENT = Regex("""/\*.*?\*/""", RegexOption.DOT_MATCHES_ALL)
        val REGISTRATION = Regex("""composable\(\s*(?:route\s*=\s*)?Screen\.(\w+)\.route""")
        val NAVIGATION = Regex("""navigate\(\s*Screen\.(\w+)\.(?:route|createRoute)""")
    }
}
