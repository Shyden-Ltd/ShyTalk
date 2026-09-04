package com.shyden.shytalk.navigation

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SHY-0143 — ORDER, not just outcome.
 *
 * `resolveColdStartDestination` proves a ban beats every other input, but a
 * pure function cannot prove the ban was *known* before routing happened. That
 * is the actual defect shape here: the checks exist, they just run too late (on
 * the sign-in path) to affect a cold start that never signs in.
 *
 * So these tests drive the sequencer with recording doubles and assert the
 * SEQUENCE. Two orderings carry the security:
 *
 *  1. **ban check → route decision.** A ban discovered after routing is a ban
 *     that already let the user into the room list.
 *  2. **token refresh → first cohort-scoped read.** A restored token carries
 *     LAST session's cohort claim. Firing a cohort-scoped read before
 *     `getIdToken(forceRefresh)` returns is the SHY-0132/0137 cross-cohort
 *     leak: a minor could be served an adult-cohort room list, or vice versa.
 *
 * Recording doubles are used deliberately and are permitted here — `commonTest`
 * is a host unit-test source set under CLAUDE.md's no-stubs rule, and ORDER is
 * exactly what a double can prove and a real backend cannot (a real service
 * would answer fast enough to hide an ordering bug most runs).
 */
class ColdStartGateOrderingTest {
    /** Records every gate as it happens, so assertions read as a timeline. */
    private class Recorder {
        val events = mutableListOf<String>()
        var subscriptionsStarted = 0
        var signedOut = false

        fun log(e: String) = events.add(e)
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
    ) = ColdStartSequencer(
        claimGate = ColdStartClaimGate(),
        checkBans = {
            rec.log("ban-check")
            BanState(deviceBanned = deviceBanned, networkBanned = networkBanned)
        },
        refreshToken = {
            rec.log("token-refresh")
            refreshSucceeds
        },
        isSessionAlive = {
            rec.log("session-alive-check")
            sessionStillAlive
        },
        startCohortScopedReads = {
            rec.log("subscriptions")
            rec.subscriptionsStarted += 1
        },
        signOut = {
            rec.log("sign-out")
            rec.signedOut = true
        },
        launchState = {
            LaunchState(
                hasStoredCredential = hasStoredCredential,
                isAppLockEnabled = false,
                isLockRequired = false,
                isAuthenticated = isAuthenticated,
                hasResolvedUser = hasResolvedUser,
            )
        },
    )

    // ── Ordering 1: the ban check precedes the route decision ──────────────

    @Test
    fun `the ban check is the first gate with an observable effect`() =
        runTest {
            // Named for exactly what it proves. An earlier version claimed "runs
            // before anything else", and mutation showed that to be overstated:
            // swapping `checkBans()` with the `launchState()` read leaves this
            // green. That mutant is BENIGN — `launchState()` is a pure read of
            // already-known repository facts, with no I/O and no security
            // consequence, so its position is immaterial. The property that
            // matters is that no gate with an EFFECT — no token refresh, no
            // cohort-scoped read — precedes the ban check, and that is pinned
            // by the ban tests below (which fail 3× if bans are ignored).
            val rec = Recorder()
            sequencer(rec).run()
            assertEquals("ban-check", rec.events.first())
        }

    @Test
    fun `a device ban routes to BanDevice and starts NO cohort-scoped reads`() =
        runTest {
            val rec = Recorder()
            val destination = sequencer(rec, deviceBanned = true).run()
            assertEquals(Screen.BanDevice, destination)
            assertEquals(0, rec.subscriptionsStarted)
            assertTrue("token-refresh" !in rec.events, "a banned start must not even refresh a token")
        }

    @Test
    fun `a network ban routes to BanNetwork and starts NO cohort-scoped reads`() =
        runTest {
            val rec = Recorder()
            val destination = sequencer(rec, networkBanned = true).run()
            assertEquals(Screen.BanNetwork, destination)
            assertEquals(0, rec.subscriptionsStarted)
        }

    @Test
    fun `a ban with NO session still routes to the ban and never to sign-in`() =
        runTest {
            val rec = Recorder()
            val destination =
                sequencer(
                    rec,
                    deviceBanned = true,
                    hasStoredCredential = false,
                    isAuthenticated = false,
                    hasResolvedUser = false,
                ).run()
            assertEquals(Screen.BanDevice, destination)
            assertEquals(0, rec.subscriptionsStarted)
        }

    // ── The ban's DETAIL must survive to the screen that renders it ────────

    @Test
    fun `the ban reason and expiry reach the caller and not just the fact of a ban`() =
        runTest {
            // BanScreen takes (banType, reason, expiresAt). If the sequencer
            // returns only "banned", the screen can only say so — and a user
            // banned by an IP/subnet/ASN rule they did not cause has no idea
            // whether it lasts an hour or forever, or how to appeal. Losing the
            // detail is how a correct gate becomes an unusable one.
            val rec = Recorder()
            val seq =
                ColdStartSequencer(
                    claimGate = ColdStartClaimGate(),
                    checkBans = {
                        rec.log("ban-check")
                        BanState(
                            deviceBanned = true,
                            reason = "Evading a prior suspension",
                            expiresAt = "2026-09-01T00:00:00Z",
                        )
                    },
                    refreshToken = { true },
                    isSessionAlive = { true },
                    startCohortScopedReads = { rec.subscriptionsStarted += 1 },
                    signOut = { rec.signedOut = true },
                    launchState = {
                        LaunchState(
                            hasStoredCredential = true,
                            isAppLockEnabled = false,
                            isLockRequired = false,
                            isAuthenticated = true,
                            hasResolvedUser = true,
                        )
                    },
                )
            assertEquals(Screen.BanDevice, seq.run())
            assertEquals("Evading a prior suspension", seq.lastBan.reason)
            assertEquals("2026-09-01T00:00:00Z", seq.lastBan.expiresAt)
        }

    // ── Ordering 2: the cohort gate precedes the first cohort-scoped read ──

    @Test
    fun `the token refresh completes BEFORE the first cohort-scoped read`() =
        runTest {
            val rec = Recorder()
            sequencer(rec).run()
            val refresh = rec.events.indexOf("token-refresh")
            val subs = rec.events.indexOf("subscriptions")
            assertTrue(refresh >= 0, "the cohort gate must run at all: ${rec.events}")
            assertTrue(subs >= 0, "reads must eventually start on a healthy cold start: ${rec.events}")
            assertTrue(refresh < subs, "cohort gate must precede reads, got ${rec.events}")
        }

    @Test
    fun `a failed token refresh signs out and starts NO cohort-scoped reads`() =
        runTest {
            // An expired/revoked refresh token means the cohort claim can never
            // be confirmed. Rendering cohort-scoped data on last session's claim
            // is the leak; signing out is the only safe answer.
            val rec = Recorder()
            val destination = sequencer(rec, refreshSucceeds = false, sessionStillAlive = false).run()
            assertEquals(Screen.SignIn, destination)
            assertEquals(0, rec.subscriptionsStarted)
            assertTrue(rec.signedOut, "a failed refresh must sign out, not silently continue")
        }

    @Test
    fun `a healthy cold start reaches Main and starts reads exactly once`() =
        runTest {
            val rec = Recorder()
            val seq = sequencer(rec)
            val destination = seq.run()
            assertEquals(Screen.Main, destination)
            assertEquals(1, rec.subscriptionsStarted)
            assertEquals(listOf("ban-check", "token-refresh", "subscriptions"), rec.events)
            assertTrue(seq.cohortVerified, "a completed refresh is what makes the claim current")
        }

    // ── A refresh that FAILS is not automatically a revoked session ───────

    @Test
    fun `an unverifiable refresh does NOT sign out and does NOT start reads`() =
        runTest {
            // `refreshIdToken()` maps EVERY exception to Resource.Error, so an
            // offline launch looked identical to a revoked token and signed the
            // user out. Android declares no `configChanges`, so rotating the
            // phone re-runs this whole sequence — meaning a rotation in
            // airplane mode logged you out.
            //
            // Firebase clears `currentUser` locally when a refresh token is
            // genuinely revoked, so a still-alive session after a failed
            // refresh means the failure was transport, not auth. The safe
            // answer is to render the shell and issue NOTHING.
            val rec = Recorder()
            val seq = sequencer(rec, refreshSucceeds = false, sessionStillAlive = true)
            val destination = seq.run()

            assertEquals(Screen.Main, destination, "an offline launch must not bounce the user to sign-in")
            assertFalse(rec.signedOut, "a transport failure is not an auth event")
            assertEquals(0, rec.subscriptionsStarted, "an unverified cohort claim must gate every read")
            assertFalse(seq.cohortVerified, "the claim was never confirmed, so nothing may act as if it were")
        }

    @Test
    fun `a revoked session is still distinguished from an unverifiable one`() =
        runTest {
            // The other side of the same branch — this must keep signing out,
            // or the fix for the offline case would strand a revoked session
            // on Main forever.
            val rec = Recorder()
            val seq = sequencer(rec, refreshSucceeds = false, sessionStillAlive = false)

            assertEquals(Screen.SignIn, seq.run())
            assertTrue(rec.signedOut)
            assertEquals(0, rec.subscriptionsStarted)
            assertFalse(seq.cohortVerified)
        }

    @Test
    fun `cohortVerified is false on every destination that is not Main`() =
        runTest {
            // The flag the nav graphs gate their user-flag subscription on. A
            // Lock or ban start MOUNTS the graph, so "we returned early" is not
            // the same as "nothing reads".
            listOf(
                sequencer(Recorder(), deviceBanned = true),
                sequencer(Recorder(), networkBanned = true),
                sequencer(Recorder(), hasStoredCredential = false, isAuthenticated = false, hasResolvedUser = false),
            ).forEach { seq ->
                seq.run()
                assertFalse(seq.cohortVerified, "no destination but Main may claim a verified cohort")
            }
        }

    @Test
    fun `an unauthenticated cold start neither refreshes nor reads`() =
        runTest {
            // No session: nothing to gate, and no cohort-scoped data to leak.
            val rec = Recorder()
            val destination =
                sequencer(rec, hasStoredCredential = false, isAuthenticated = false, hasResolvedUser = false).run()
            assertEquals(Screen.SignIn, destination)
            assertEquals(0, rec.subscriptionsStarted)
            assertTrue("token-refresh" !in rec.events, "no session ⇒ no token to refresh: ${rec.events}")
        }
}

/**
 * SHY-0143 I5 — the background cohort reconcile.
 *
 * `pm-lock-check` is what makes the SERVER recompute a user's cohort and mint
 * a fresh claim. It ran only on the sign-in path, which the optimistic cold
 * start skips, so a user whose birthday passed stayed in the minor cohort
 * until they next signed in.
 */
class CohortReconcileTest {
    @Test
    fun `a minted claim is followed by a token rotation`() =
        runTest {
            val order = mutableListOf<String>()
            val rotated =
                reconcileCohortInBackground(
                    uniqueId = "10000005",
                    checkPmLock = {
                        order.add("pm-lock-check")
                        true
                    },
                    refreshToken = {
                        order.add("token-refresh")
                        true
                    },
                )

            assertTrue(rotated)
            assertEquals(listOf("pm-lock-check", "token-refresh"), order)
        }

    @Test
    fun `no mint means no rotation`() =
        runTest {
            // Rotating on every launch would burn Firebase mint quota for a
            // claim that did not change.
            var refreshes = 0
            val rotated =
                reconcileCohortInBackground(
                    uniqueId = "10000005",
                    checkPmLock = { false },
                    refreshToken = {
                        refreshes += 1
                        true
                    },
                )

            assertFalse(rotated)
            assertEquals(0, refreshes)
        }

    @Test
    fun `a failing pm-lock check is non-fatal and rotates nothing`() =
        runTest {
            var refreshes = 0
            val rotated =
                reconcileCohortInBackground(
                    uniqueId = "10000005",
                    checkPmLock = { throw IllegalStateException("backend unreachable") },
                    refreshToken = {
                        refreshes += 1
                        true
                    },
                )

            assertFalse(rotated, "an unreachable server is not evidence of a cohort change")
            assertEquals(0, refreshes)
        }

    @Test
    fun `a blank uniqueId reconciles nothing rather than querying for an empty id`() =
        runTest {
            var checks = 0
            val rotated =
                reconcileCohortInBackground(
                    uniqueId = "   ",
                    checkPmLock = {
                        checks += 1
                        true
                    },
                    refreshToken = { true },
                )

            assertFalse(rotated)
            assertEquals(0, checks, "a blank id must never reach the server")
        }
}
