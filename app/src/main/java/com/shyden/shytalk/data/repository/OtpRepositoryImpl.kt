package com.shyden.shytalk.data.repository

import com.shyden.shytalk.data.remote.WorkerApiClient
import org.json.JSONObject

class OtpRepositoryImpl(
    private val apiClient: WorkerApiClient,
) : OtpRepository {
    override suspend fun sendOtp(email: String): Result<Unit> =
        runCatching {
            apiClient.postPublic(
                "/api/auth/otp/send",
                JSONObject().apply {
                    put("email", email)
                },
            )
        }

    override suspend fun verifyOtp(
        email: String,
        code: String,
    ): Result<String> =
        runCatching {
            val response =
                apiClient.postPublic(
                    "/api/auth/otp/verify",
                    JSONObject().apply {
                        put("email", email)
                        put("code", code)
                    },
                )
            response.getString("customToken")
        }
}
