package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.data.remote.IosApiClient
import dev.gitlive.firebase.auth.FirebaseAuth
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

class IosIdentityRepositoryImpl(
    private val apiClient: IosApiClient,
    private val auth: FirebaseAuth,
) : IdentityRepository {
    override suspend fun resolveIdentity(
        provider: String,
        identifier: String,
    ): Resource<SignInResult> =
        try {
            val body = buildBody("provider" to provider, "identifier" to identifier)
            val response = apiClient.post("/api/users/sign-in", body)

            val found = response["found"]?.jsonPrimitive?.boolean ?: false
            if (found) {
                val uniqueId = response["uniqueId"]!!.jsonPrimitive.long
                Resource.Success(SignInResult.Found(uniqueId))
            } else {
                val deactivated = response["deactivated"]?.jsonPrimitive?.boolean ?: false
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
            val fields =
                mutableListOf<Pair<String, JsonPrimitive>>(
                    "provider" to JsonPrimitive(provider),
                    "identifier" to JsonPrimitive(identifier),
                    "language" to JsonPrimitive(language),
                )
            displayName?.let { fields.add("displayName" to JsonPrimitive(it)) }
            email?.let { fields.add("email" to JsonPrimitive(it)) }
            profilePhotoUrl?.let { fields.add("profilePhotoUrl" to JsonPrimitive(it)) }
            dateOfBirth?.let { fields.add("dateOfBirth" to JsonPrimitive(it)) }

            val body = JsonObject(fields.toMap())
            val response = apiClient.post("/api/users", body)
            val uniqueId = response["uniqueId"]!!.jsonPrimitive.long
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
            val body = buildBody("provider" to provider, "identifier" to identifier)
            apiClient.post("/api/users/$uniqueId/link-provider", body)
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
            val body = buildBody("provider" to provider, "identifier" to identifier)
            apiClient.delete("/api/users/$uniqueId/link-provider", body)
            Resource.Success(Unit)
        } catch (e: Exception) {
            logE("IdentityRepository", "unlinkProvider failed: ${e.message}", e)
            Resource.Error(e.message ?: "Failed to unlink provider", e)
        }

    override suspend fun forceRefreshToken(): Resource<Unit> =
        try {
            apiClient.clearTokenCache()
            auth.currentUser?.getIdToken(true)
            Resource.Success(Unit)
        } catch (e: Exception) {
            logE("IdentityRepository", "forceRefreshToken failed: ${e.message}", e)
            Resource.Error(e.message ?: "Failed to refresh token", e)
        }

    private fun buildBody(vararg pairs: Pair<String, String>): JsonObject = JsonObject(pairs.associate { (k, v) -> k to JsonPrimitive(v) })
}
