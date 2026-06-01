package com.shyden.shytalk.feature.auth

/**
 * Persona-picker password sign-in helper. Hides the Android
 * `Tasks → await()` vs. iOS GitLive Firebase KMP `suspend` impedance
 * mismatch behind a single suspend fun so the persona picker in the
 * consolidated SignInScreen can call one thing on both platforms.
 *
 * **NOT** for production sign-in. The shared persona password matches
 * Firebase Emulator seed data on the local flavor (hardcoded
 * `localdev123`) AND the dev Firebase Auth project on the dev flavor
 * (whatever `DEV_QA_PERSONAS_PASSWORD` was set to when the personas
 * were seeded via the `seed-test-personas` workflow). The prod
 * Firebase project has NO persona accounts, so this credential cannot
 * succeed there.
 *
 * Caller MUST gate this behind both `BuildVariant.isDevAffordancesVisible`
 * (env allow-list: local + dev only) AND `BuildVariant.isPersonaPickerAvailable`
 * (the shared password slot must be populated) AT THE CALL SITE —
 * defence-in-depth against a Frida-runtime flag flip or misconfigured
 * build. The single-account dev-sign-in slot + its
 * `BuildVariant.isLocalEmulator` gate were removed on 2026-06-01.
 *
 * **Exception types diverge by platform.** Android propagates
 * `com.google.firebase.auth.FirebaseAuthInvalidUserException` /
 * `FirebaseAuthInvalidCredentialsException` etc.; iOS propagates the
 * same logical errors via `dev.gitlive.firebase.auth.*` wrappers.
 * Callers that need to discriminate (e.g. "user not found" vs "wrong
 * password") must add a common abstraction — currently every caller
 * just shows a fixed error string, so the divergence is invisible.
 */
expect suspend fun performDevSignIn(
    email: String,
    password: String,
)
