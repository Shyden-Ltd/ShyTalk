package com.shyden.shytalk.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.tasks.await
import org.json.JSONObject

private fun JSONObject.optStringOrNull(key: String): String? {
    if (!has(key) || isNull(key)) return null
    return optString(key).takeIf { it.isNotEmpty() }
}

class DeviceRepositoryImpl(
    private val firestore: FirebaseFirestore,
    private val workerApiClient: WorkerApiClient,
) : DeviceRepository {
    override suspend fun getDeviceBinding(deviceId: String): Resource<String?> =
        firebaseCall("Failed to check device binding") {
            val doc = firestore.document("deviceBindings/$deviceId").get().await()
            val data = doc.data ?: return@firebaseCall null
            (data["uniqueId"] ?: data["userId"])?.toString()
        }

    override suspend fun bindDevice(
        deviceId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to bind device") {
            firestore
                .document("deviceBindings/$deviceId")
                .set(
                    mapOf(
                        "userId" to userId,
                        "boundAt" to System.currentTimeMillis(),
                    ),
                ).await()
        }

    override suspend fun checkBanStatus(deviceId: String): Resource<BanStatus> =
        try {
            val body = JSONObject().apply { put("deviceId", deviceId) }
            val response = workerApiClient.post("/api/device-info", body)
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
