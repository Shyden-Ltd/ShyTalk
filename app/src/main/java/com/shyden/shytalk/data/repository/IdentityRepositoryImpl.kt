package com.shyden.shytalk.data.repository

import com.google.firebase.auth.FirebaseAuth
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

class IdentityRepositoryImpl(
    private val workerApiClient: WorkerApiClient,
    private val firebaseAuth: FirebaseAuth,
) : IdentityRepository {
    override suspend fun resolveIdentity(
        provider: String,
        identifier: String,
    ): Resource<SignInResult> =
        try {
            val body =
                JSONObject().apply {
                    put("provider", provider)
                    put("identifier", identifier)
                }
            val response = workerApiClient.post("/api/users/sign-in", body)

            val found = response.optBoolean("found", false)
            if (found) {
                val uniqueId = response.getLong("uniqueId")
                Resource.Success(SignInResult.Found(uniqueId))
            } else {
                val deactivated = response.optBoolean("deactivated", false)
                if (deactivated) {
                    Resource.Success(SignInResult.Deactivated)
                } else {
                    Resource.Success(SignInResult.NotFound)
                }
            }
        } catch (e: Exception) {
            logE("IdentityRepository", "resolveIdentity failed: ${e.message}", e)
            Resource.Error(e.message ?: "Failed to resolve identity", e)
        }

    override suspend fun createUser(
        provider: String,
        identifier: String,
        displayName: String?,
        email: String?,
        profilePhotoUrl: String?,
        dateOfBirth: Long?,
        language: String,
    ): Resource<CreateUserResult> =
        try {
            val body =
                JSONObject().apply {
                    put("provider", provider)
                    put("identifier", identifier)
                    displayName?.let { put("displayName", it) }
                    email?.let { put("email", it) }
                    profilePhotoUrl?.let { put("profilePhotoUrl", it) }
                    dateOfBirth?.let { put("dateOfBirth", it) }
                    put("language", language)
                }
            val response = workerApiClient.post("/api/users", body)
            val uniqueId = response.getLong("uniqueId")
            Resource.Success(CreateUserResult(uniqueId))
        } catch (e: Exception) {
            logE("IdentityRepository", "createUser failed: ${e.message}", e)
            Resource.Error(e.message ?: "Failed to create user", e)
        }

    override suspend fun linkProvider(
        uniqueId: Long,
        provider: String,
        identifier: String,
    ): Resource<Unit> =
        try {
            val body =
                JSONObject().apply {
                    put("provider", provider)
                    put("identifier", identifier)
                }
            workerApiClient.post("/api/users/$uniqueId/link-provider", body)
            Resource.Success(Unit)
        } catch (e: Exception) {
            logE("IdentityRepository", "linkProvider failed: ${e.message}", e)
            Resource.Error(e.message ?: "Failed to link provider", e)
        }

    override suspend fun unlinkProvider(
        uniqueId: Long,
        provider: String,
        identifier: String,
    ): Resource<Unit> =
        try {
            val body =
                JSONObject().apply {
                    put("provider", provider)
                    put("identifier", identifier)
                }
            workerApiClient.delete("/api/users/$uniqueId/link-provider", body)
            Resource.Success(Unit)
        } catch (e: Exception) {
            logE("IdentityRepository", "unlinkProvider failed: ${e.message}", e)
            Resource.Error(e.message ?: "Failed to unlink provider", e)
        }

    override suspend fun forceRefreshToken(): Resource<Unit> =
        try {
            workerApiClient.clearTokenCache()
            firebaseAuth.currentUser?.getIdToken(true)?.await()
            Resource.Success(Unit)
        } catch (e: Exception) {
            logE("IdentityRepository", "forceRefreshToken failed: ${e.message}", e)
            Resource.Error(e.message ?: "Failed to refresh token", e)
        }
}
