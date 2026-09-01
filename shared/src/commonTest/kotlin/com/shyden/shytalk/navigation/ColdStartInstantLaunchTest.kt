package com.shyden.shytalk.navigation

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * SHY-0500 — what is drawn FIRST, and what is allowed to change it afterwards.
 *
 * SHY-0143 built the right sequence and then made the whole app wait for it:
 * `run()` awaited a ban check and a token refresh — two network round trips —
 * before returning any destination at all, and nothing rendered until it did.
 * On a slow connection the person watches a spinner; on no connection they
 * watch it for the timeout. That is the loading screen EPIC-0004 exists to
 * remove, wearing a different hat.
 *
 * The split is the fix. Whether a session exists is a LOCAL question, so it is
 * answered with no I/O and drawn immediately; everything that needs the network
 * runs behind the screen the person is already looking at and may then correct
 * it.
 *
 * Both halves are asserted, because either alone is a different bug:
 *
 *  - The immediate decision must touch NOTHING. A "fast path" that still awaits
 *    a call is the same bug with a shorter name, and it would pass a test that
 *    only checked which screen came back.
 *  - The confirmation must still enforce every gate. An optimistic shell that
 *    skipped the ban check or issued cohort-scoped reads before the claim was
 *    refreshed would be a security regression dressed as a performance win.
 */
class ColdStartInstantLaunchTest {
    private class Recorder {
        val events = mutableListOf<String>()
        var subscriptionsStarted = 0
        var signedOut = false
    }

    private fun sequencer(
        rec: Recorder,
        deviceBanned: Boolean = false,
        networkBanned: Boolean = false,
        refreshSucceeds: Boolean = true,
        sessionStillAlive: Boolean = true,
        isAuthenticated: Boolean = true,
        hasResolvedUser: Boolean = true,
        hasStoredCredential: Boolean = true,
        isAppLockEnabled: Boolean = false,
        isLockRequired: Boolean = false,
    ) = ColdStartSequencer(
        checkBans = {
            rec.events.add("ban-check")
            BanState(deviceBanned = deviceBanned, networkBanned = networkBanned)
        },
        refreshToken = {
            rec.events.add("token-refresh")
            refreshSucceeds
        },
        isSessionAlive = { sessionStillAlive },
        startCohortScopedReads = {
            rec.events.add("cohort-read")
            rec.subscriptionsStarted++
        },
        signOut = {
            rec.events.add("sign-out")
            rec.signedOut = true
        },
        launchState = {
            rec.events.add("launch-state")
            LaunchState(
                hasStoredCredential = hasStoredCredential,
                isAppLockEnabled = isAppLockEnabled,
                isLockRequired = isLockRequired,
                isAuthenticated = isAuthenticated,
                hasResolvedUser = hasResolvedUser,
            )
        },
    )

    // ─── The immediate decision ─────────────────────────────────────────────

    @Test
    fun immediateDestination_touchesTheNetworkNotAtAll() {
        // The whole point. A destination that is "fast" but still awaits a call
        // is the defect this story was filed for.
        val rec = Recorder()
        sequencer(rec).immediateDestination()
        assertEquals(
            listOf("launch-state"),
            rec.events,
            "the immediate decision must read local state and nothing else",
        )
    }

    @Test
    fun immediateDestination_isTheRoomListWhenASessionExists() {
        val rec = Recorder()
        assertEquals(Screen.Main, sequencer(rec).immediateDestination())
    }

    @Test
    fun immediateDestination_isSignInWhenThereIsNoSessionAtAll() {
        // Answerable locally, so it must not cost a round trip. Somebody with no
        // session should see sign-in as the first thing drawn, not after one.
        val rec = Recorder()
        val s = sequencer(rec, isAuthenticated = false, hasStoredCredential = false, hasResolvedUser = false)
        assertEquals(Screen.SignIn, s.immediateDestination())
        assertEquals(listOf("launch-state"), rec.events)
    }

    @Test
    fun immediateDestination_stillHonoursAppLock() {
        val rec = Recorder()
        val s = sequencer(rec, isAppLockEnabled = true, isLockRequired = true)
        assertEquals(Screen.Lock, s.immediateDestination())
    }

    // ─── The background confirmation ────────────────────────────────────────

    @Test
    fun confirm_leavesAGoodSessionAloneAndStartsTheReads() =
        runTest {
            val rec = Recorder()
            val s = sequencer(rec)
            s.immediateDestination()
            assertEquals(ColdStartConfirmation.Stay, s.confirm())
            assertEquals(1, rec.subscriptionsStarted)
        }

    @Test
    fun confirm_refreshesTheTokenBeforeAnyCohortScopedRead() =
        runTest {
            // SHY-0132/0137. A restored token carries LAST session's cohort
            // claim, so a read issued before the refresh can serve the wrong
            // cohort. Rendering the shell early must not move this line.
            val rec = Recorder()
            val s = sequencer(rec)
            s.immediateDestination()
            s.confirm()
            assertTrue(
                rec.events.indexOf("token-refresh") < rec.events.indexOf("cohort-read"),
                "a cohort-scoped read was issued before the claim was refreshed: ${rec.events}",
            )
        }

    @Test
    fun confirm_sendsADeadSessionBackToSignInWithAReason() =
        runTest {
            // The operator's requirement: do not drop somebody on the sign-in
            // screen with no explanation.
            val rec = Recorder()
            val s = sequencer(rec, refreshSucceeds = false, sessionStillAlive = false)
            s.immediateDestination()
            assertEquals(
                ColdStartConfirmation.Redirect(Screen.SignIn, LaunchRedirectReason.SESSION_EXPIRED),
                s.confirm(),
            )
            assertTrue(rec.signedOut, "a dead session must be signed out, not merely navigated away from")
            assertEquals(0, rec.subscriptionsStarted)
        }

    @Test
    fun confirm_keepsAnOfflinePersonExactlyWhereTheyAre() =
        runTest {
            // A transport failure is not a sign-out. This is what turned
            // "rotate the phone in airplane mode" into "you are logged out".
            val rec = Recorder()
            val s = sequencer(rec, refreshSucceeds = false, sessionStillAlive = true)
            s.immediateDestination()
            assertEquals(ColdStartConfirmation.Stay, s.confirm())
            assertTrue(!rec.signedOut, "an offline device must not be signed out")
            assertEquals(0, rec.subscriptionsStarted, "unverified claim must issue no cohort-scoped read")
        }

    @Test
    fun confirm_stillEjectsABannedDevice() =
        runTest {
            val rec = Recorder()
            val s = sequencer(rec, deviceBanned = true)
            s.immediateDestination()
            assertEquals(
                ColdStartConfirmation.Redirect(Screen.BanDevice, null),
                s.confirm(),
            )
            assertEquals(0, rec.subscriptionsStarted, "a banned start must read none of the person's data")
        }

    @Test
    fun confirm_stillEjectsABannedNetwork() =
        runTest {
            val rec = Recorder()
            val s = sequencer(rec, networkBanned = true)
            s.immediateDestination()
            assertEquals(ColdStartConfirmation.Redirect(Screen.BanNetwork, null), s.confirm())
        }

    @Test
    fun confirm_checksBansBeforeItRefreshesAnything() =
        runTest {
            val rec = Recorder()
            val s = sequencer(rec, deviceBanned = true)
            s.immediateDestination()
            s.confirm()
            assertTrue(
                "token-refresh" !in rec.events,
                "a banned start must not touch the session at all: ${rec.events}",
            )
        }

    @Test
    fun confirm_doesNotRedirectSomebodyWhoWasNeverGoingToTheRoomList() =
        runTest {
            // Nothing to confirm for a start that is already heading to sign-in:
            // there is no session to validate and no data to gate.
            val rec = Recorder()
            val s = sequencer(rec, isAuthenticated = false, hasStoredCredential = false, hasResolvedUser = false)
            assertEquals(Screen.SignIn, s.immediateDestination())
            assertEquals(ColdStartConfirmation.Stay, s.confirm())
            assertEquals(0, rec.subscriptionsStarted)
        }
}
