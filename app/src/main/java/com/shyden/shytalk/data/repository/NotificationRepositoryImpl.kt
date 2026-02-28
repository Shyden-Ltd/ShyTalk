package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.data.remote.WorkerApiClient
import org.json.JSONObject

class NotificationRepositoryImpl(
    private val api: WorkerApiClient
) : NotificationRepository {

    override suspend fun saveFcmToken(userId: String, token: String): Resource<Unit> =
        firebaseCall("Failed to save FCM token") {
            api.post("/api/notifications/token", JSONObject().apply {
                put("token", token)
            })
            Unit
        }

    override suspend fun removeFcmToken(userId: String, token: String): Resource<Unit> =
        firebaseCall("Failed to remove FCM token") {
            api.delete("/api/notifications/token", JSONObject().apply {
                put("token", token)
            })
            Unit
        }

    override suspend fun setPmNotificationsEnabled(userId: String, enabled: Boolean): Resource<Unit> =
        firebaseCall("Failed to update notification setting") {
            api.patch("/api/notifications/settings", JSONObject().apply {
                put("pm_notifications_enabled", enabled)
            })
            Unit
        }

    override suspend fun getPmNotificationsEnabled(userId: String): Resource<Boolean> =
        firebaseCall("Failed to get notification setting") {
            val user = api.get("/api/users/$userId")
            user.optBoolean("pm_notifications_enabled", true)
        }
}
