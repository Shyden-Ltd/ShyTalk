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
