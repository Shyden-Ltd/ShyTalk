package com.shyden.shytalk.navigation

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * SHY-0187 — the pure launch-destination resolver both platforms consume.
 *
 * The cascade under test (mirrors AuthViewModel's init semantics exactly):
 *  1. no stored credential                          → SignIn
 *  2. app-lock enabled AND lock required            → Lock   (the App-Lock gate)
 *  3. live session AND resolved user                → Main   (silent restore)
 *  4. otherwise (credential + dead session)         → Lock   (PIN re-entry; its
 *     requiresReauth callback routes onward to SignIn when restore is impossible)
 *
 * Every test asserts an exact Screen — never "not Main" ([[feedback-ac-traceability-in-tests]]).
 */
class LaunchDestinationTest {
    private data class Case(
        val hasStoredCredential: Boolean,
        val isAppLockEnabled: Boolean,
        val isLockRequired: Boolean,
        val isAuthenticated: Boolean,
        val hasResolvedUser: Boolean,
        val expected: Screen,
    )

    private fun resolve(c: Case): Screen =
        resolveLaunchDestination(
            hasStoredCredential = c.hasStoredCredential,
            isAppLockEnabled = c.isAppLockEnabled,
            isLockRequired = c.isLockRequired,
            isAuthenticated = c.isAuthenticated,
            hasResolvedUser = c.hasResolvedUser,
        )

    private fun expectedFor(
        cred: Boolean,
        enabled: Boolean,
        required: Boolean,
        auth: Boolean,
        user: Boolean,
    ): Screen =
        when {
            !cred -> Screen.SignIn
            enabled && required -> Screen.Lock
            auth && user -> Screen.Main
            else -> Screen.Lock
        }

    @Test
    fun `cold launch with lock enabled and required lands on Lock for every auth state`() {
        for (auth in listOf(false, true)) {
            for (user in listOf(false, true)) {
                val c =
                    Case(
                        hasStoredCredential = true,
                        isAppLockEnabled = true,
                        isLockRequired = true,
                        isAuthenticated = auth,
                        hasResolvedUser = user,
                        expected = Screen.Lock,
                    )
                assertEquals(Screen.Lock, resolve(c), "lock-required must gate auth=$auth user=$user")
            }
        }
    }

    @Test
    fun `silent restore reaches Main only with live session and resolved user and no pending lock gate`() {
        // The three no-gate lock states: disabled+not-required, disabled+required
        // (isLockRequired is meaningless while disabled), enabled+not-required
        // (timeout not yet expired).
        val noGateLockStates =
            listOf(
                false to false,
                false to true,
                true to false,
            )
        for ((enabled, required) in noGateLockStates) {
            val c =
                Case(
                    hasStoredCredential = true,
                    isAppLockEnabled = enabled,
                    isLockRequired = required,
                    isAuthenticated = true,
                    hasResolvedUser = true,
                    expected = Screen.Main,
                )
            assertEquals(
                Screen.Main,
                resolve(c),
                "silent restore must reach Main for enabled=$enabled required=$required",
            )
        }
    }

    @Test
    fun `no stored credential always resolves SignIn regardless of every other flag`() {
        for (enabled in listOf(false, true)) {
            for (required in listOf(false, true)) {
                for (auth in listOf(false, true)) {
                    for (user in listOf(false, true)) {
                        val c =
                            Case(
                                hasStoredCredential = false,
                                isAppLockEnabled = enabled,
                                isLockRequired = required,
                                isAuthenticated = auth,
                                hasResolvedUser = user,
                                expected = Screen.SignIn,
                            )
                        assertEquals(
                            Screen.SignIn,
                            resolve(c),
                            "no credential must resolve SignIn for enabled=$enabled required=$required auth=$auth user=$user",
                        )
                    }
                }
            }
        }
    }

    @Test
    fun `stored credential with dead or unresolved session resolves Lock so PIN reauth can route onward`() {
        // Rule-4 rows: credential present, no lock gate pending, but the session
        // is not fully restorable (not authenticated, or no resolved user).
        val noGateLockStates =
            listOf(
                false to false,
                false to true,
                true to false,
            )
        for ((enabled, required) in noGateLockStates) {
            for ((auth, user) in listOf(false to false, false to true, true to false)) {
                val c =
                    Case(
                        hasStoredCredential = true,
                        isAppLockEnabled = enabled,
                        isLockRequired = required,
                        isAuthenticated = auth,
                        hasResolvedUser = user,
                        expected = Screen.Lock,
                    )
                assertEquals(
                    Screen.Lock,
                    resolve(c),
                    "credentialed dead session must resolve Lock for enabled=$enabled required=$required auth=$auth user=$user",
                )
            }
        }
    }

    @Test
    fun `full 32-state matrix resolves exactly`() {
        val bools = listOf(false, true)
        var checked = 0
        for (cred in bools) {
            for (enabled in bools) {
                for (required in bools) {
                    for (auth in bools) {
                        for (user in bools) {
                            val expected = expectedFor(cred, enabled, required, auth, user)
                            val c =
                                Case(
                                    hasStoredCredential = cred,
                                    isAppLockEnabled = enabled,
                                    isLockRequired = required,
                                    isAuthenticated = auth,
                                    hasResolvedUser = user,
                                    expected = expected,
                                )
                            assertEquals(
                                expected,
                                resolve(c),
                                "state cred=$cred enabled=$enabled required=$required auth=$auth user=$user",
                            )
                            checked++
                        }
                    }
                }
            }
        }
        assertEquals(32, checked, "the matrix must cover every combination")
    }

    @Test
    fun `relock on resume fires on post-auth content when the lock is due`() {
        for (route in listOf(Screen.Main.route, Screen.Splash.route, Screen.Warning.route, "room/123")) {
            assertEquals(
                true,
                shouldRelockOnResume(
                    hasStoredCredential = true,
                    isAppLockEnabled = true,
                    isLockRequired = true,
                    currentRoute = route,
                ),
                "resume on $route with a due lock must re-gate",
            )
        }
    }

    @Test
    fun `relock on resume never fires on the lock or pre-auth screens`() {
        for (route in listOf(Screen.Lock.route, Screen.SignIn.route, Screen.EmailSignIn.route)) {
            assertEquals(
                false,
                shouldRelockOnResume(
                    hasStoredCredential = true,
                    isAppLockEnabled = true,
                    isLockRequired = true,
                    currentRoute = route,
                ),
                "resume on $route must not double-gate",
            )
        }
    }

    @Test
    fun `relock on resume never fires without credential or lock enablement or a due lock`() {
        val offStates =
            listOf(
                Triple(false, true, true),
                Triple(true, false, true),
                Triple(true, true, false),
            )
        for ((cred, enabled, required) in offStates) {
            assertEquals(
                false,
                shouldRelockOnResume(
                    hasStoredCredential = cred,
                    isAppLockEnabled = enabled,
                    isLockRequired = required,
                    currentRoute = Screen.Main.route,
                ),
                "cred=$cred enabled=$enabled required=$required must not re-gate",
            )
        }
    }

    @Test
    fun `relock on resume is a no-op while navigation has no current route`() {
        // The cold-launch resolver owns the pre-navigation window; firing here
        // would navigate an unready controller.
        assertEquals(
            false,
            shouldRelockOnResume(
                hasStoredCredential = true,
                isAppLockEnabled = true,
                isLockRequired = true,
                currentRoute = null,
            ),
        )
    }

    @Test
    fun `deep-link navigation is gated while the Lock screen is showing regardless of timer state`() {
        for (required in listOf(false, true)) {
            assertEquals(
                true,
                isNavigationLockGated(
                    hasStoredCredential = true,
                    isAppLockEnabled = true,
                    isLockRequired = required,
                    currentRoute = Screen.Lock.route,
                ),
                "a deep link must never navigate over a showing Lock screen (required=$required)",
            )
        }
    }

    @Test
    fun `deep-link navigation is gated when a lock is due even before Lock renders`() {
        for (route in listOf(Screen.Main.route, Screen.Splash.route, null)) {
            assertEquals(
                true,
                isNavigationLockGated(
                    hasStoredCredential = true,
                    isAppLockEnabled = true,
                    isLockRequired = true,
                    currentRoute = route,
                ),
                "a due lock must gate deep links on route=$route (covers the pre-composition race)",
            )
        }
    }

    @Test
    fun `deep-link navigation is not gated without a due lock away from the Lock screen`() {
        val offStates =
            listOf(
                Triple(false, true, true),
                Triple(true, false, true),
                Triple(true, true, false),
            )
        for ((cred, enabled, required) in offStates) {
            assertEquals(
                false,
                isNavigationLockGated(
                    hasStoredCredential = cred,
                    isAppLockEnabled = enabled,
                    isLockRequired = required,
                    currentRoute = Screen.Main.route,
                ),
                "cred=$cred enabled=$enabled required=$required on Main must not gate deep links",
            )
        }
    }

    @Test
    fun `lock gate outranks silent restore when both apply`() {
        // The single most security-critical ordering: a fully-restorable session
        // that ALSO has a pending lock must land on Lock, never Main.
        assertEquals(
            Screen.Lock,
            resolveLaunchDestination(
                hasStoredCredential = true,
                isAppLockEnabled = true,
                isLockRequired = true,
                isAuthenticated = true,
                hasResolvedUser = true,
            ),
        )
    }
}
