package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource

interface AuthRepository {
    /**
     * Returns the resolved uniqueId (e.g. "10000005") after identity resolution,
     * falling back to the Firebase UID if identity hasn't been resolved yet.
     * All ViewModels should use this for Firestore paths and API calls.
     */
    val currentUserId: String?
    val isAuthenticated: Boolean
    val currentUserEmail: String?

    /** The raw Firebase Auth UID. Use only for Firebase-specific operations. */
    val currentFirebaseUid: String?

    /**
     * Resolves once the SDK has loaded whatever user it PERSISTED — a
     * keychain or preferences read, never the network.
     *
     * The Android SDK restores its user synchronously, so [isAuthenticated] and
     * [currentFirebaseUid] are right from the first call. The iOS SDK restores
     * asynchronously: read too early they say "nobody", the identity cache
     * keyed by that uid misses, and a cold start draws sign-in first for a
     * signed-in person (SHY-0500). A cold start calls this before it decides
     * what to draw. The wait is gated by the identity cache's own record — the
     * only local sign that a user is coming — so a signed-out start does not
     * wait at all, and bounded on every platform: a launch may never hang on it.
     *
     * Deliberately no default. A platform whose SDK restores the user
     * synchronously says so in its own override; a `{}` here let a platform
     * that simply forgot the wait compile, and draw sign-in for a signed-in
     * person.
     */
    suspend fun awaitPersistedSession()

    /**
     * Set by AuthViewModel after successful identity resolution.
     * Makes [currentUserId] return the uniqueId instead of Firebase UID.
     */
    var resolvedUniqueId: String?

    /**
     * The signed-in user's chosen display name, cached from the User
     * doc fetched in `AuthViewModel.resolveProfileState` (and refreshed
     * by `ProfileViewModel.saveProfile`). Read by the dev-only
     * `PreviewWatermark` so leaked screenshots identify both the
     * uniqueId and the operator-facing name without an extra Firestore
     * round-trip from the watermark.
     *
     * Null until the first profile load completes, and cleared on
     * sign-out alongside [resolvedUniqueId].
     */
    var resolvedDisplayName: String?

    /**
     * The signed-in user's EFFECTIVE segregation cohort (`"adult"` /
     * `"minor"`, i.e. `cohortOverride ?: cohort` — the same value every
     * enforcement layer reads). Cached from the same User-doc fetch that
     * populates [resolvedDisplayName], for the dev-only `PreviewWatermark`
     * (SHY-0205): cross-cohort QA screenshots become self-evident when
     * the badge names the viewer's cohort. Null until the first profile
     * load, cleared on sign-out alongside the other resolved slots.
     */
    var resolvedCohort: String?

    /**
     * Returns the first linked provider's type and identifier from the current
     * Firebase Auth user, or null if not authenticated.
     *
     * Provider mapping:
     * - google.com → ("google", email)
     * - apple.com  → ("apple", provider-uid)
     * - password   → ("email", email)
     */
    fun getProviderInfo(): Pair<String, String>?

    suspend fun signInWithGoogleIdToken(idToken: String): Resource<String>

    suspend fun signInWithAppleIdToken(
        idToken: String,
        rawNonce: String,
    ): Resource<String>

    suspend fun signInWithAppleViaProvider(activity: Any): Resource<String>

    suspend fun sendSignInLink(email: String): Resource<Unit>

    suspend fun signInWithEmailLink(
        email: String,
        link: String,
    ): Resource<String>

    suspend fun signInWithCustomToken(token: String): Resource<String>

    suspend fun signOut()

    /**
     * Force-refresh the Firebase ID token (JWT).
     *
     * Called by [UserRepository.checkPmLockOnLogin] when the server
     * response carries `forceTokenRefresh: true` — i.e. after the
     * pm-lock-check route flipped the user's cohort and minted a
     * fresh custom claim server-side. Without this round-trip the
     * client's cached JWT carries the old cohort until Firebase's
     * ~1h auto-refresh window closes, leaving Firestore rules-layer
     * enforcement stale (the Express + KMP layers see the fresh
     * field so this is degraded — not broken — but UK OSA defence
     * in depth requires all four layers in sync).
     *
     * On Android: `auth.currentUser.getIdToken(forceRefresh = true)`.
     * On iOS: GitLive equivalent via `auth.currentUser?.getIdToken(true)`.
     * Both must surface failures as [Resource.Error] so callers can
     * log and decide to retry — swallowing the failure as
     * [Resource.Success] would lie about JWT state.
     */
    suspend fun refreshIdToken(): Resource<Unit>
}
