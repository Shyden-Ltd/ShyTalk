package com.shyden.shytalk.navigation

import java.io.File
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SHY-0500 review findings (2026-09-04), pinned at the source the way the
 * SHY-0187 wiring pins are:
 *
 *  1. The session-expired reason was set once and never cleared, so the
 *     "Your session has ended" snackbar fired again every time the sign-in
 *     screen was composed later in the same process -- after a deliberate
 *     sign-out, for one. It is consumed once now: the screen reports it shown
 *     and the owner clears it.
 *  2. On iPhone a redirect only rewrote the start destination of a NavHost that
 *     had already mounted, which moves nothing. It navigates now, as Android
 *     always has.
 *  3. The room list subscribes to cohort-scoped data at mount, which is before
 *     a restored session's claim refresh returns. It waits on the cold-start
 *     claim gate first, so "claim refreshed before any cohort-scoped read"
 *     stays true after the shell stopped waiting for the network.
 */
class LaunchRedirectIsAOneShotPinTest {
    private fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            if (File(dir, "settings.gradle.kts").exists()) return dir
            dir = dir.parentFile
        }
        error("settings.gradle.kts not found above ${System.getProperty("user.dir")}")
    }

    private fun read(relative: String): String {
        val f = File(repoRoot(), relative)
        assertTrue(f.exists(), "moved: $relative")
        return f.readText()
    }

    private val signIn = "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/SignInScreen.kt"
    private val params = "shared/src/commonMain/kotlin/com/shyden/shytalk/navigation/PlatformScreens.kt"
    private val iosScreens = "shared/src/iosMain/kotlin/com/shyden/shytalk/navigation/IosPlatformScreens.kt"
    private val sharedGraph = "shared/src/commonMain/kotlin/com/shyden/shytalk/navigation/SharedNavGraph.kt"
    private val androidGraph = "app/src/main/java/com/shyden/shytalk/navigation/NavGraph.kt"
    private val mainActivity = "app/src/main/java/com/shyden/shytalk/MainActivity.kt"
    private val controller = "shared/src/iosMain/kotlin/com/shyden/shytalk/MainViewController.kt"
    private val home = "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/home/HomeViewModel.kt"

    @Test
    fun `the sign-in screen reports the session-expired message shown, after showing it`() {
        val src = read(signIn)
        assertTrue(src.contains("onSessionExpiredShown: () -> Unit = {}"), "SignInScreen needs onSessionExpiredShown")
        val effect = src.indexOf("LaunchedEffect(sessionExpired)")
        val shown = src.indexOf("snackbarHostState.showSnackbar(getString(Res.string.session_expired_sign_in_again))")
        val reported = src.indexOf("onSessionExpiredShown()")
        assertTrue(effect in 0..<shown && shown < reported, "report AFTER the snackbar returns, inside the effect")
    }

    @Test
    fun `both nav graphs hand the sign-in screen a way to clear the reason`() {
        assertTrue(read(params).contains("val onSessionExpiredShown: () -> Unit = {}"), "SignInScreenParams")
        assertTrue(read(iosScreens).contains("onSessionExpiredShown = params.onSessionExpiredShown"), "IosPlatformScreens")
        for (graph in listOf(sharedGraph, androidGraph)) {
            val src = read(graph)
            assertTrue(src.contains("onLaunchRedirectConsumed: () -> Unit = {}"), "$graph must take onLaunchRedirectConsumed")
            assertTrue(src.contains("onSessionExpiredShown = onLaunchRedirectConsumed"), "$graph must thread it to the sign-in screen")
        }
    }

    @Test
    fun `each platform clears the reason once the screen has shown it`() {
        for (owner in listOf(mainActivity, controller)) {
            assertTrue(
                read(owner).contains("onLaunchRedirectConsumed = { launchRedirect = null }"),
                "$owner must clear launchRedirect when the message has been shown",
            )
        }
    }

    @Test
    fun `iOS applies a redirect by navigating, not by rewriting a mounted start destination`() {
        val src = read(controller)
        // EVERY redirect goes through the same state — a ban route as much as
        // sign-in. iOS has no ban overlay above the graph the way Android does,
        // so a ban found behind an optimistic room list must move the screen too.
        assertTrue(src.contains("redirectTo = confirmation.screen"), "every Redirect must set redirectTo")
        val effect = src.indexOf("LaunchedEffect(redirectTo)")
        assertTrue(effect >= 0, "MainViewController must react to redirectTo")
        val body = src.substring(effect, minOf(effect + 400, src.length))
        assertTrue(body.contains("navController.navigate(target.route)"), "the reaction must navigate")
        assertTrue(body.contains("popUpTo(0) { inclusive = true }"), "and clear the optimistic screen from the back stack")
        assertFalse(src.contains("value = confirmation.screen.route"), "rewriting the start destination after mount moves nothing")
    }

    @Test
    fun `the room list waits on the cold-start claim gate before its cohort-scoped subscription`() {
        val src = read(home)
        val wait = src.indexOf("claimGate.awaitSettled()")
        val read = src.indexOf(".getActiveRooms(cohort)")
        assertTrue(wait >= 0, "HomeViewModel must await the claim gate")
        assertTrue(read >= 0 && wait < read, "the wait must precede the cohort-scoped read")
    }

    @Test
    fun `a ban verdict moves the screen on both platforms, each the way its host renders bans`() {
        // Android renders BanScreen ABOVE the NavHost from the confirmation's ban
        // facts, so its Redirect branch only has to carry the sign-in reason;
        // iOS has no such overlay and navigates to the ban route. A reviewer
        // reading one host without the other concludes the ban is dropped
        // (2026-09-04); this pin is the answer.
        val android = read(mainActivity)
        assertTrue(android.contains("coldStartBan = sequencer.lastBan"), "Android must publish the ban facts the confirmation found")
        val overlay = android.indexOf("coldStartBan.deviceBanned || coldStartBan.networkBanned ->")
        assertTrue(overlay >= 0, "Android must branch to the ban overlay on those facts")
        assertTrue(android.indexOf("BanScreen(", overlay) in overlay..overlay + 200, "and render BanScreen there")
        val ios = read(controller)
        assertTrue(ios.contains("coldStartBan = sequencer.lastBan"), "iOS must publish the ban facts for the ban route")
        assertTrue(ios.contains("redirectTo = confirmation.screen"), "and navigate to it, since nothing renders above its graph")
    }

    @Test
    fun `both hosts confirm straight after drawing, so nothing can cancel between begin() and settle()`() {
        // The gate is engaged by immediateDestination() and settled only when
        // confirm() returns. A suspension point between the two is a window in
        // which a cancelled effect, or a throw, leaves every cohort-scoped read
        // waiting for the life of the process (review, 2026-09-04): the room
        // list never loads. Anything else the launch awaits runs before the
        // draw as a deferred, or after the confirmation.
        for (owner in listOf(mainActivity, controller)) {
            val src = read(owner)
            val drawn = src.indexOf("sequencer.immediateDestination()")
            val confirmed = src.indexOf("sequencer.confirm()")
            assertTrue(drawn in 0..<confirmed, "$owner must draw, then confirm")
            val between = src.substring(drawn, confirmed)
            for (suspendCall in listOf(".await(", "getLatestVersionInfo(", "checkBackendHealth(", "delay(")) {
                assertFalse(between.contains(suspendCall), "$owner awaits $suspendCall between drawing and confirming")
            }
        }
    }

    @Test
    fun `MainActivity no longer claims an ordering the NavHost stopped providing`() {
        val src = read(mainActivity)
        assertFalse(
            src.contains("the NavHost cannot mount until `checkComplete`"),
            "the shell mounts before confirm() now; the claim gate holds the reads, and the comment must say so",
        )
        assertTrue(src.contains("ColdStartClaimGate"), "MainActivity must name the gate that replaced the ordering")
    }
}
