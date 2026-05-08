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
}
