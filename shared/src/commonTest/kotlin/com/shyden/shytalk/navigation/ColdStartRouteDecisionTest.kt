package com.shyden.shytalk.navigation

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * SHY-0143 — the ban gate must precede the cold-start route decision.
 *
 * WHY THIS EXISTS, precisely. SHY-0187 shipped the optimistic cold start:
 * `resolveLaunchDestination` returns [Screen.Main] as soon as
 * `isAuthenticated && hasResolvedUser`, and `hasResolvedUser` is
 * `currentUserId != null`, which the AuthRepository contract makes non-null
 * IMMEDIATELY on a restored session (it falls back to the Firebase UID before
 * identity resolves). So a returning user reaches the room list without
 * passing through sign-in.
 *
 * The ban checks never moved with it:
 *  - `AuthViewModel.checkAndApplyBan()` is private, with two call sites, both
 *    inside `resolveIdentityAndProceed()` — a sign-in-only path.
 *  - `BanScreen` is rendered from INSIDE `SignInScreen.kt`, off
 *    `AuthUiState.isDeviceBanned/isNetworkBanned`.
 *
 * Those two facts together mean the ban screen is structurally unreachable on
 * the optimistic path: the check never runs, and even if it did, the only
 * surface that renders its result is a screen the user never visits. A banned
 * device — or a banned IP/subnet/ASN, which is also how VPNs are blocked —
 * currently lands in the room list on cold start.
 *
 * Not yet in a cut release (`v0.98.0` predates the resolver), so this closes a
 * release-blocker rather than a production incident.
 *
 * The contract under test: a ban outranks EVERY other input. Not "usually
 * wins", not "wins when signed in" — outranks. That is why the matrix below is
 * exhaustive over the other five inputs rather than a handful of samples: a
 * gate that holds for the cases someone thought of is not a gate.
 *
 * Every assertion names an exact [Screen] ([[feedback-ac-traceability-in-tests]]).
 */
class ColdStartRouteDecisionTest {
    private fun resolve(
        deviceBanned: Boolean = false,
        networkBanned: Boolean = false,
        hasStoredCredential: Boolean = true,
        isAppLockEnabled: Boolean = false,
        isLockRequired: Boolean = false,
        isAuthenticated: Boolean = true,
        hasResolvedUser: Boolean = true,
    ): Screen =
        resolveColdStartDestination(
            deviceBanned = deviceBanned,
            networkBanned = networkBanned,
            hasStoredCredential = hasStoredCredential,
            isAppLockEnabled = isAppLockEnabled,
            isLockRequired = isLockRequired,
            isAuthenticated = isAuthenticated,
            hasResolvedUser = hasResolvedUser,
        )

    // ── The gap this story closes ──────────────────────────────────────────

    @Test
    fun `a banned device with a restored session does NOT reach the room list`() {
        // The exact live gap: today this returns Screen.Main.
        assertEquals(Screen.BanDevice, resolve(deviceBanned = true))
    }

    @Test
    fun `a banned network with a restored session does NOT reach the room list`() {
        assertEquals(Screen.BanNetwork, resolve(networkBanned = true))
    }

    @Test
    fun `a banned device with NO session shows the ban and never the login screen`() {
        // "never shows login" is the story's wording, and it matters: showing
        // SignIn invites a banned user to try another account.
        assertEquals(
            Screen.BanDevice,
            resolve(deviceBanned = true, hasStoredCredential = false, isAuthenticated = false, hasResolvedUser = false),
        )
    }

    @Test
    fun `a banned network with NO session shows the ban and never the login screen`() {
        assertEquals(
            Screen.BanNetwork,
            resolve(networkBanned = true, hasStoredCredential = false, isAuthenticated = false, hasResolvedUser = false),
        )
    }

    @Test
    fun `a ban outranks a due App-Lock`() {
        // Lock is the highest-priority non-ban gate; if a ban loses to it, a
        // banned user gets a PIN prompt and then the room list.
        assertEquals(
            Screen.BanDevice,
            resolve(deviceBanned = true, isAppLockEnabled = true, isLockRequired = true),
        )
    }

    @Test
    fun `a device ban outranks a simultaneous network ban`() {
        // Both flags set must be deterministic, not implementation-order
        // dependent. Device is the narrower, more specific fact, so it wins.
        assertEquals(Screen.BanDevice, resolve(deviceBanned = true, networkBanned = true))
    }

    @Test
    fun `a ban wins across EVERY combination of the other five inputs`() {
        // Exhaustive: 2^5 = 32 combinations per ban variant. A precedence rule
        // proven on chosen samples is a rule that holds where someone looked.
        var checked = 0
        for (cred in listOf(true, false)) {
            for (lockOn in listOf(true, false)) {
                for (lockDue in listOf(true, false)) {
                    for (authed in listOf(true, false)) {
                        for (resolved in listOf(true, false)) {
                            assertEquals(
                                Screen.BanDevice,
                                resolve(true, false, cred, lockOn, lockDue, authed, resolved),
                                "device ban must win (cred=$cred lockOn=$lockOn lockDue=$lockDue authed=$authed resolved=$resolved)",
                            )
                            assertEquals(
                                Screen.BanNetwork,
                                resolve(false, true, cred, lockOn, lockDue, authed, resolved),
                                "network ban must win (cred=$cred lockOn=$lockOn lockDue=$lockDue authed=$authed resolved=$resolved)",
                            )
                            checked += 2
                        }
                    }
                }
            }
        }
        // Necessity guard: if the loop above ever stops iterating, the test
        // must fail rather than pass vacuously.
        assertEquals(64, checked)
    }

    // ── Unbanned behaviour is UNCHANGED (regression, not new behaviour) ─────
    //
    // SHY-0187 already delivers these. They are asserted here so the ban gate
    // cannot be added by breaking the silent restore it sits in front of.

    @Test
    fun `with no ban the SHY-0187 cascade is preserved exactly`() {
        for (cred in listOf(true, false)) {
            for (lockOn in listOf(true, false)) {
                for (lockDue in listOf(true, false)) {
                    for (authed in listOf(true, false)) {
                        for (resolved in listOf(true, false)) {
                            assertEquals(
                                resolveLaunchDestination(cred, lockOn, lockDue, authed, resolved),
                                resolve(false, false, cred, lockOn, lockDue, authed, resolved),
                                "unbanned cold start must equal the existing resolver " +
                                    "(cred=$cred lockOn=$lockOn lockDue=$lockDue authed=$authed resolved=$resolved)",
                            )
                        }
                    }
                }
            }
        }
    }
}
