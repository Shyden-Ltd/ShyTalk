package com.shyden.shytalk.data.repository

import com.shyden.shytalk.data.remote.WorkerApiClient
import org.json.JSONObject
import java.net.URLEncoder

class BiometricRepositoryImpl(
    private val apiClient: WorkerApiClient,
) : BiometricRepository {
    override suspend fun register(
        publicKeyBase64: String,
        deviceId: String,
    ): Result<Unit> =
        runCatching {
            apiClient.post(
                "/api/auth/biometric/register",
                JSONObject().apply {
                    put("publicKey", publicKeyBase64)
                    put("deviceId", deviceId)
                },
            )
        }

    override suspend fun getChallenge(
        uniqueId: String,
        deviceId: String,
    ): Result<String> =
        runCatching {
            val uid = URLEncoder.encode(uniqueId, "UTF-8")
            val did = URLEncoder.encode(deviceId, "UTF-8")
            val response = apiClient.getPublic("/api/auth/biometric/challenge?uniqueId=$uid&deviceId=$did")
            response.getString("challenge")
        }

    override suspend fun verify(
        uniqueId: String,
        deviceId: String,
        signatureBase64: String,
    ): Result<String> =
        runCatching {
            val response =
                apiClient.postPublic(
                    "/api/auth/biometric/verify",
                    JSONObject().apply {
                        put("uniqueId", uniqueId)
                        put("deviceId", deviceId)
                        put("signature", signatureBase64)
                    },
                )
            response.getString("customToken")
        }

    override suspend fun revoke(deviceId: String): Result<Unit> =
        runCatching {
            apiClient.delete("/api/auth/biometric/$deviceId")
        }
}
