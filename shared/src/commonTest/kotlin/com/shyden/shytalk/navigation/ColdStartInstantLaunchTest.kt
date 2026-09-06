package com.shyden.shytalk.navigation

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertFalse
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
        claimGate: ColdStartClaimGate = ColdStartClaimGate(),
    ) = ColdStartSequencer(
        claimGate = claimGate,
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
    fun immediateDestination_isTheRoomListForASignedInPersonWhoNeverEnrolledAppLock() {
        // What the OnePlus actually holds after a persona sign-in (2026-09-04):
        // a live Firebase user, a cached identity, and NO App-Lock credential --
        // PIN enrolment only happens from the Lock screen's "reset" path, so
        // this is every signed-in person's normal state. The fixture's default
        // of `hasStoredCredential = true` hid it: the phone drew sign-in first
        // and took the network round trip the story exists to remove.
        val rec = Recorder()
        assertEquals(Screen.Main, sequencer(rec, hasStoredCredential = false).immediateDestination())
        // With nothing enrolled there is nothing to lock behind, so a "due"
        // lock cannot apply either.
        assertEquals(
            Screen.Main,
            sequencer(rec, hasStoredCredential = false, isAppLockEnabled = true, isLockRequired = true)
                .immediateDestination(),
        )
        assertEquals(listOf("launch-state", "launch-state"), rec.events)
    }

    @Test
    fun confirm_refusesToRunBeforeAnythingWasDrawn() =
        runTest {
            // `confirm()` reasons about what `immediateDestination()` drew. Called
            // alone it used to compare against nothing and answer with a
            // reasonless Redirect on every launch (review, 2026-09-04).
            val rec = Recorder()
            val error = assertFailsWith<IllegalStateException> { sequencer(rec).confirm() }
            assertTrue(error.message.orEmpty().contains("immediateDestination()"), error.message)
        }

    @Test
    fun aRestoredSessionHoldsCohortScopedReadsUntilItIsConfirmed_thenReleasesThem() =
        runTest {
            // The shell mounts before confirm() returns, so the order "claim
            // refreshed before any cohort-scoped read" lives in this gate now,
            // not in when the NavHost mounts (review, 2026-09-04).
            val gate = ColdStartClaimGate()
            val s = sequencer(Recorder(), claimGate = gate)
            assertFalse(gate.refreshInFlight.value)
            s.immediateDestination()
            assertTrue(gate.refreshInFlight.value, "drawing the room list from a stored session must hold reads")
            s.confirm()
            assertFalse(gate.refreshInFlight.value, "a confirmed claim releases them")
        }

    @Test
    fun anUnreachableNetworkReleasesTheGate_theCachedRoomListIsAllThereIs() =
        runTest {
            // Offline, the claim cannot be refreshed at all and the room list
            // serves the cache it was authorised to fill last time — the same
            // as before this story. Holding it would be a room list that never
            // loads for anyone who opens the app on a train.
            val gate = ColdStartClaimGate()
            val s = sequencer(Recorder(), refreshSucceeds = false, sessionStillAlive = true, claimGate = gate)
            s.immediateDestination()
            assertTrue(gate.refreshInFlight.value)
            assertTrue(s.confirm() is ColdStartConfirmation.Stay)
            assertFalse(gate.refreshInFlight.value, "a transport failure must settle the gate")
        }

    @Test
    fun aDeadSessionKeepsTheGateEngagedUntilTheHostHasMovedTheScreen() =
        runTest {
            // confirm() signs the dead session out and answers Redirect. The
            // room list is still mounted until the host navigates; releasing
            // its reads here would fire them against a session that no longer
            // exists (review, 2026-09-04). Every Redirect leaves the gate to
            // the host, which settles it AFTER popUpTo(0) has cleared the room
            // list and its ViewModel — the same rule as a ban.
            val gate = ColdStartClaimGate()
            val s = sequencer(Recorder(), refreshSucceeds = false, sessionStillAlive = false, claimGate = gate)
            s.immediateDestination()
            val outcome = s.confirm()
            assertTrue(outcome is ColdStartConfirmation.Redirect && outcome.screen == Screen.SignIn)
            assertTrue(gate.refreshInFlight.value, "a dead-session redirect must leave the gate to the host")
        }

    @Test
    fun aBanKeepsTheGateEngaged_theRoomListDrawnUnderneathMustNeverRead() =
        runTest {
            // Before SHY-0500 a banned cold start never mounted the room list.
            // Now it is drawn first, so the ban verdict must NOT release its
            // reads: nothing cohort-scoped may load for a banned person, on a
            // claim the confirmation never refreshed (review, 2026-09-04). The
            // host settles the gate itself once the ban screen has replaced
            // the room list and its ViewModel is gone.
            for (variant in listOf("device", "network")) {
                val gate = ColdStartClaimGate()
                val s =
                    if (variant == "device") {
                        sequencer(Recorder(), deviceBanned = true, claimGate = gate)
                    } else {
                        sequencer(Recorder(), networkBanned = true, claimGate = gate)
                    }
                s.immediateDestination()
                val outcome = s.confirm()
                assertTrue(outcome is ColdStartConfirmation.Redirect, variant)
                assertTrue(gate.refreshInFlight.value, "a $variant ban must leave the gate engaged")
            }
        }

    @Test
    fun aThrowInsideConfirmLeavesTheGateEngaged_failClosed() =
        runTest {
            // Before SHY-0500 a throw here meant nothing rendered. Now the room
            // list is already drawn, so releasing its reads on a throw would be
            // a cohort-scoped read with no verdict and an unconfirmed claim
            // (review, 2026-09-04). Fail closed: the gate stays engaged, the
            // throw propagates to the host, and the next draw supersedes it.
            val gate = ColdStartClaimGate()
            val s =
                ColdStartSequencer(
                    claimGate = gate,
                    checkBans = { throw IllegalStateException("ban service exploded") },
                    refreshToken = { true },
                    isSessionAlive = { true },
                    startCohortScopedReads = {},
                    signOut = {},
                    launchState = {
                        LaunchState(
                            hasStoredCredential = false,
                            isAppLockEnabled = false,
                            isLockRequired = false,
                            isAuthenticated = true,
                            hasResolvedUser = true,
                        )
                    },
                )
            s.immediateDestination()
            assertTrue(gate.refreshInFlight.value)
            assertFailsWith<IllegalStateException> { s.confirm() }
            assertTrue(gate.refreshInFlight.value, "a throw must not release the reads: there is no verdict to release them on")
        }

    @Test
    fun aSignInFirstLaunchNeverEngagesTheGate() =
        runTest {
            // Nothing cohort-scoped is drawn, so nothing waits: a fresh sign-in
            // must reach its room list without a cold-start confirmation
            // (the SHY-0024 failure shape, where a once-per-process flag
            // stayed false after a normal sign-in).
            val gate = ColdStartClaimGate()
            val s = sequencer(Recorder(), isAuthenticated = false, hasStoredCredential = false, hasResolvedUser = false, claimGate = gate)
            assertEquals(Screen.SignIn, s.immediateDestination())
            assertFalse(gate.refreshInFlight.value)
            s.confirm()
            assertFalse(gate.refreshInFlight.value)
        }

    @Test
    fun aNewDrawSupersedesAnEarlierOneThatWasNeverConfirmed() =
        runTest {
            // The gate is one instance per process and a host can be torn down
            // between drawing and confirming (an Activity recreated mid-launch).
            // The NEXT draw is the truth about what is on screen now: it must
            // release an engagement the earlier run never got to settle, or the
            // room list of every later launch waits forever (review, 2026-09-04).
            val gate = ColdStartClaimGate()
            sequencer(Recorder(), claimGate = gate).immediateDestination()
            assertTrue(gate.refreshInFlight.value, "the abandoned run engaged the gate")

            val next =
                sequencer(
                    Recorder(),
                    isAuthenticated = false,
                    hasStoredCredential = false,
                    hasResolvedUser = false,
                    claimGate = gate,
                )
            assertEquals(Screen.SignIn, next.immediateDestination())
            assertFalse(gate.refreshInFlight.value, "a draw that holds nothing cohort-scoped must leave the gate open")

            val redrawn = sequencer(Recorder(), claimGate = gate)
            redrawn.immediateDestination()
            assertTrue(gate.refreshInFlight.value, "a fresh room-list draw engages it again")
            redrawn.confirm()
            assertFalse(gate.refreshInFlight.value)
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
