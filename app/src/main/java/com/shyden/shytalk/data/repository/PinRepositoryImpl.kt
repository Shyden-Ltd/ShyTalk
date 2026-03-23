package com.shyden.shytalk.data.repository

import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.WorkerApiClient
import org.json.JSONObject

class PinRepositoryImpl(
    private val apiClient: WorkerApiClient,
) : PinRepository {
    override suspend fun setupPin(pin: String): Result<String> =
        runCatching {
            val response =
                apiClient.post(
                    "/api/auth/pin/setup",
                    JSONObject().apply {
                        put("pin", pin)
                    },
                )
            response.getString("pinHash")
        }

    override suspend fun verifyPin(
        uniqueId: String,
        deviceId: String,
        pin: String,
    ): Result<PinVerifyResult> =
        try {
            val response =
                apiClient.postPublic(
                    "/api/auth/pin/verify",
                    JSONObject().apply {
                        put("uniqueId", uniqueId)
                        put("deviceId", deviceId)
                        put("pin", pin)
                    },
                )
            Result.success(
                PinVerifyResult(
                    customToken = response.getString("customToken"),
                ),
            )
        } catch (e: ApiException) {
            when (e.statusCode) {
                401 -> {
                    // Wrong PIN
                    val remaining =
                        try {
                            JSONObject(e.message ?: "{}").optInt("attemptsRemaining", 0)
                        } catch (_: Exception) {
                            0
                        }
                    Result.success(PinVerifyResult(attemptsRemaining = remaining))
                }
                423 -> {
                    // Locked out — default requiresReauth to true (fail-secure)
                    val body =
                        try {
                            JSONObject(e.message ?: "{}")
                        } catch (_: Exception) {
                            JSONObject()
                        }
                    Result.success(
                        PinVerifyResult(
                            locked = true,
                            lockedUntil = body.optLong("lockedUntil", 0),
                            requiresReauth = body.optBoolean("requiresReauth", true),
                            attemptsRemaining = 0,
                        ),
                    )
                }
                else -> Result.failure(e)
            }
        } catch (e: Exception) {
            Result.failure(e)
        }

    override suspend fun resetPin(newPin: String): Result<Unit> =
        runCatching {
            apiClient.post(
                "/api/auth/pin/reset",
                JSONObject().apply {
                    put("pin", newPin)
                },
            )
        }
}
