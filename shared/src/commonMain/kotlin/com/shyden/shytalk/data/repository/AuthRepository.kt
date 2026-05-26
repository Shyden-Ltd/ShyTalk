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
