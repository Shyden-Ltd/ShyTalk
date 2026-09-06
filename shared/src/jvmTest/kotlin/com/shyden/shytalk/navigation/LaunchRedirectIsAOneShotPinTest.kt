package com.shyden.shytalk.navigation

import com.shyden.shytalk.testsupport.RepoSource.read
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
    fun `both hosts apply a redirect by navigating, and release the gate only once the corrected screen has replaced the room list`() {
        // EVERY redirect goes through the same state — a ban route as much as
        // sign-in — and navigates with popUpTo(0), which clears the optimistic
        // room list and its ViewModel from the back stack. That clearing is
        // what makes a redirect safe: the sequencer keeps the claim gate
        // engaged on every Redirect, so the room list drawn underneath can
        // read neither on the unrefreshed claim (a ban) nor against a session
        // just signed out (a dead session), and the host settles the gate
        // AFTER the navigation so nothing is left waiting for a later sign-in.
        for (owner in listOf(mainActivity, controller)) {
            val src = read(owner)
            assertTrue(src.contains("redirectTo = confirmation.screen"), "$owner: every Redirect must set redirectTo")
            val effect = src.indexOf("LaunchedEffect(redirectTo)")
            assertTrue(effect >= 0, "$owner must react to redirectTo")
            val body = src.substring(effect, minOf(effect + 900, src.length))
            val navigate = body.indexOf("navController.navigate(target.route)")
            assertTrue(navigate >= 0, "$owner: the reaction must navigate")
            assertTrue(
                body.contains("popUpTo(0) { inclusive = true }"),
                "$owner: and clear the optimistic screen from the back stack",
            )
            val settle = body.indexOf("claimGate.settle()")
            assertTrue(settle > navigate, "$owner: the gate is released after the navigation, never before")
        }
        assertFalse(
            read(controller).contains("value = confirmation.screen.route"),
            "rewriting the start destination after mount moves nothing",
        )
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
    fun `a ban verdict replaces the room list on both platforms, and Android also covers it`() {
        // Both hosts navigate to the ban route (the pin above), which pops the
        // room list and its ViewModel. Android additionally renders BanScreen
        // ABOVE the NavHost from the confirmation's ban facts, so even a frame
        // in which the navigation has not landed yet shows the ban. iOS has no
        // overlay; the navigation is the whole answer there.
        val android = read(mainActivity)
        assertTrue(android.contains("coldStartBan = sequencer.lastBan"), "Android must publish the ban facts the confirmation found")
        val overlay = android.indexOf("coldStartBan.deviceBanned || coldStartBan.networkBanned ->")
        assertTrue(overlay >= 0, "Android must branch to the ban overlay on those facts")
        assertTrue(android.indexOf("BanScreen(", overlay) in overlay..overlay + 200, "and render BanScreen there")
        val ios = read(controller)
        assertTrue(ios.contains("coldStartBan = sequencer.lastBan"), "iOS must publish the ban facts for the ban route")
    }

    @Test
    fun `both hosts apply the verdict before they await anything else`() {
        // The verdict is a ban or a dead session; applying it late leaves a banned
        // device on the optimistic room list for as long as the other launch
        // calls take (review, 2026-09-04). Publishing the ban facts and the
        // redirect is the FIRST thing after confirm() returns.
        for (owner in listOf(mainActivity, controller)) {
            val src = read(owner)
            val confirmed = src.indexOf("sequencer.confirm()")
            assertTrue(confirmed >= 0, "$owner must confirm")
            val nextAwait = src.indexOf(".await(", confirmed).let { if (it < 0) src.length else it }
            val beforeAnyAwait = src.substring(confirmed, nextAwait)
            assertTrue(
                beforeAnyAwait.contains("coldStartBan = sequencer.lastBan"),
                "$owner must publish the ban facts before it awaits anything",
            )
            assertTrue(
                beforeAnyAwait.contains("ColdStartConfirmation.Redirect"),
                "$owner must apply the redirect before it awaits anything",
            )
        }
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
