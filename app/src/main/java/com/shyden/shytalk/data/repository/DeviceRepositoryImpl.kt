package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.remote.WorkerApiClient
import org.json.JSONObject
import java.net.URLEncoder

private fun JSONObject.optStringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key).takeIf { it.isNotEmpty() }
}

class DeviceRepositoryImpl(
    private val workerApiClient: WorkerApiClient,
) : DeviceRepository {
    override suspend fun resolveDeviceLock(deviceId: String): Resource<DeviceLockStatus> =
        try {
            val body = JSONObject().apply { put("deviceId", deviceId) }
            val response = workerApiClient.post("/api/devices/lock-check", body)
            val status =
                if (response.optString("status") == "locked") {
                    DeviceLockStatus.LOCKED
                } else {
                    DeviceLockStatus.ALLOWED
                }
            Resource.Success(status)
        } catch (e: Exception) {
            // Lenient: a lock-check outage must not lock out real users (logged for debugging).
            logW("DeviceRepository", "Device lock-check failed, allowing through: ${e.message}")
            Resource.Error(e.message ?: "Device lock-check failed")
        }

    /**
     * SHY-0143 — reads the UNAUTHENTICATED `/api/ban-status`, not
     * `/api/device-info`.
     *
     * `/api/device-info` sits behind `authMiddleware`, so with no Firebase
     * session `getIdToken()` threw `IllegalStateException("Not signed in")`
     * before the request was built, and the catch below turned that into
     * "not banned" — a banned user who was signed out reached the sign-in
     * screen, which the story's AC names as the thing that must never happen.
     * `/api/ban-status` answers the same question with no token, and writes
     * nothing (device-info upserts a binding and runs a cap transaction,
     * which has no business running on every cold start and every rotation).
     */
    override suspend fun checkBanStatus(deviceId: String): Resource<BanStatus> =
        try {
            val response =
                workerApiClient.getPublic(
                    "/api/ban-status?deviceId=" + URLEncoder.encode(deviceId, "UTF-8"),
                )
            val banObj = response.optJSONObject("banStatus")
            if (banObj != null && banObj.optBoolean("isBanned", false)) {
                Resource.Success(
                    BanStatus(
                        isBanned = true,
                        banType = banObj.optStringOrNull("banType"),
                        reason = banObj.optStringOrNull("reason"),
                        expiresAt = banObj.optStringOrNull("expiresAt"),
                    ),
                )
            } else {
                Resource.Success(BanStatus())
            }
        } catch (e: Exception) {
            // Lenient: if ban check fails, allow through (but log it for debugging)
            logW("DeviceRepository", "Ban check failed, allowing through: ${e.message}")
            Resource.Success(BanStatus())
        }
}
