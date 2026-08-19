package com.shyden.shytalk.navigation

/**
 * Resolves the launch/start destination from auth + App-Lock state (SHY-0187).
 *
 * The single shared decision BOTH platforms consume (Android `MainActivity`
 * initial route, iOS `MainViewController` start destination), so the same
 * state can never resolve differently per platform.
 *
 * Pure and synchronous by contract: no I/O, no clock reads — callers pass the
 * already-known repository facts. Cascade (mirrors `AuthViewModel`'s init
 * semantics):
 *  1. No stored credential → [Screen.SignIn].
 *  2. App-Lock enabled AND the lock timeout has expired → [Screen.Lock]
 *     (the gate outranks a restorable session — physical access must not
 *     reveal the account).
 *  3. Live session with a resolved user → [Screen.Main] (silent restore).
 *  4. Otherwise (credential present, session dead/unresolved) → [Screen.Lock]:
 *     PIN re-entry drives session restore; its `requiresReauth` path routes
 *     to Sign-In when restore is impossible.
 */
fun resolveLaunchDestination(
    hasStoredCredential: Boolean,
    isAppLockEnabled: Boolean,
    isLockRequired: Boolean,
    isAuthenticated: Boolean,
    hasResolvedUser: Boolean,
): Screen =
    when {
        !hasStoredCredential -> Screen.SignIn
        isAppLockEnabled && isLockRequired -> Screen.Lock
        isAuthenticated && hasResolvedUser -> Screen.Main
        else -> Screen.Lock
    }

/**
 * SHY-0143 — the cold-start decision, with the ban gate in FRONT of
 * [resolveLaunchDestination].
 *
 * Why this wrapper exists rather than more branches inside the resolver above:
 * the ban gate is not another step in the App-Lock cascade, it is a
 * precondition on the whole cascade. Expressing it as a layer makes the
 * precedence a structural property — there is no ordering of the inner `when`
 * that can let a ban lose — and keeps SHY-0187's cascade readable and
 * unchanged.
 *
 * The gap this closes: SHY-0187 made a restored session route straight to
 * [Screen.Main], because `hasResolvedUser` is `currentUserId != null` and the
 * `AuthRepository` contract makes that non-null immediately (it falls back to
 * the Firebase UID before identity resolves). The ban checks did not move with
 * it — `AuthViewModel.checkAndApplyBan()` is reachable only from the sign-in
 * path, and `BanScreen` renders only from inside `SignInScreen`. A returning
 * banned user therefore skipped both. See the story for the enumeration.
 *
 * Device outranks network when both are set: it is the narrower, more specific
 * fact, and a fixed order keeps the outcome deterministic rather than
 * dependent on which check happened to answer first.
 *
 * Pure and synchronous like its inner resolver — the CALLER is responsible for
 * having already obtained the ban facts. That is deliberate: it keeps this
 * function trivially testable, and it forces the ban lookup to be an explicit,
 * awaited step in the startup sequence rather than something that might still
 * be in flight when routing happens.
 */
fun resolveColdStartDestination(
    deviceBanned: Boolean,
    networkBanned: Boolean,
    hasStoredCredential: Boolean,
    isAppLockEnabled: Boolean,
    isLockRequired: Boolean,
    isAuthenticated: Boolean,
    hasResolvedUser: Boolean,
): Screen =
    when {
        deviceBanned -> Screen.BanDevice

        networkBanned -> Screen.BanNetwork

        else ->
            resolveLaunchDestination(
                hasStoredCredential = hasStoredCredential,
                isAppLockEnabled = isAppLockEnabled,
                isLockRequired = isLockRequired,
                isAuthenticated = isAuthenticated,
                hasResolvedUser = hasResolvedUser,
            )
    }

/**
 * Warm-resume re-lock decision (SHY-0187): whether returning to the
 * foreground must interpose the Lock screen over the current content.
 *
 * Fires only when a due App-Lock exists AND there is post-auth content to
 * protect: the Lock screen itself and the pre-auth screens (Sign-In,
 * e-mail OTP) never re-gate. A `null` route means navigation isn't ready —
 * the cold-launch resolver owns that window, and navigating an unready
 * controller would crash.
 */
fun shouldRelockOnResume(
    hasStoredCredential: Boolean,
    isAppLockEnabled: Boolean,
    isLockRequired: Boolean,
    currentRoute: String?,
): Boolean {
    if (currentRoute == null) return false
    val exempt =
        currentRoute == Screen.Lock.route ||
            currentRoute == Screen.SignIn.route ||
            currentRoute == Screen.EmailSignIn.route
    return hasStoredCredential && isAppLockEnabled && isLockRequired && !exempt
}

/**
 * Deep-link gate (SHY-0187): whether a programmatic navigation triggered by
 * an external intent (push tap, room invite, chat deep link) must be DROPPED
 * because the App-Lock stands between the user and content.
 *
 * True when the Lock screen is currently showing (regardless of the timer —
 * navigating over a rendered lock is always a bypass) OR when
 * [resolveLaunchDestination] would choose the Lock for the same state: a due
 * lock (including the cold-launch/pre-composition race, where the intent
 * handler runs before the start destination composes) or rule 4's
 * credentialed dead session. The gate DELEGATES to the resolver so the two
 * decisions can never diverge. A signed-out state is deliberately NOT
 * lock-gated — the resolver says Sign-In and every call site's
 * identity-not-resolved check owns that drop. Droppers log and clear the
 * pending link — fail-closed.
 */
fun isNavigationLockGated(
    hasStoredCredential: Boolean,
    isAppLockEnabled: Boolean,
    isLockRequired: Boolean,
    isAuthenticated: Boolean,
    hasResolvedUser: Boolean,
    currentRoute: String?,
): Boolean =
    currentRoute == Screen.Lock.route ||
        resolveLaunchDestination(
            hasStoredCredential = hasStoredCredential,
            isAppLockEnabled = isAppLockEnabled,
            isLockRequired = isLockRequired,
            isAuthenticated = isAuthenticated,
            hasResolvedUser = hasResolvedUser,
        ) == Screen.Lock
