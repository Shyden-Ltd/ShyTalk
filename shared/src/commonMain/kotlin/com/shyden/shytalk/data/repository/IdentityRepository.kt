package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource

/**
 * Result of identity resolution during sign-in.
 */
sealed class SignInResult {
    /** Identity found and active — user's uniqueId is returned. */
    data class Found(
        val uniqueId: Long,
    ) : SignInResult()

    /** No identity map entry exists for this provider+identifier. */
    data object NotFound : SignInResult()

    /** Identity exists but has been deactivated (soft-removed). */
    data object Deactivated : SignInResult()
}

/**
 * Result of creating a new user account.
 */
data class CreateUserResult(
    val uniqueId: Long,
)

/**
 * Repository for identity resolution and provider management.
 * Communicates with the Express API (not Firestore directly).
 */
interface IdentityRepository {
    /**
     * Resolve identity via Express API POST /api/users/sign-in.
     * Returns the uniqueId if the provider+identifier is linked and active.
     */
    suspend fun resolveIdentity(
        provider: String,
        identifier: String,
    ): Resource<SignInResult>

    /**
     * Create a new user account via Express API POST /api/users.
     * Returns the newly assigned uniqueId.
     */
    suspend fun createUser(
        provider: String,
        identifier: String,
        displayName: String?,
        email: String?,
        profilePhotoUrl: String?,
        dateOfBirth: Long?,
        language: String,
    ): Resource<CreateUserResult>

    /**
     * Link an additional provider via Express API POST /api/users/:uniqueId/link-provider.
     */
    suspend fun linkProvider(
        uniqueId: Long,
        provider: String,
        identifier: String,
    ): Resource<Unit>

    /**
     * Unlink (soft-remove) a provider via Express API DELETE /api/users/:uniqueId/link-provider.
     */
    suspend fun unlinkProvider(
        uniqueId: Long,
        provider: String,
        identifier: String,
    ): Resource<Unit>

    /**
     * Force refresh the Firebase ID token to pick up updated custom claims (uniqueId).
     * Must be called after createUser or resolveIdentity.
     */
    suspend fun forceRefreshToken(): Resource<Unit>
}
