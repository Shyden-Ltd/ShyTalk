package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.data.remote.WorkerApiClient
import org.json.JSONObject

class NotificationRepositoryImpl(
    private val api: WorkerApiClient,
) : NotificationRepository {
    override suspend fun saveFcmToken(
        userId: String,
        token: String,
    ): Resource<Unit> =
        firebaseCall<Unit>("Failed to save FCM token") {
            api.post(
                "/api/notifications/token",
                JSONObject().apply {
                    put("token", token)
                },
            )
        }

    override suspend fun removeFcmToken(
        userId: String,
        token: String,
    ): Resource<Unit> =
        firebaseCall<Unit>("Failed to remove FCM token") {
            api.delete(
                "/api/notifications/token",
                JSONObject().apply {
                    put("token", token)
                },
            )
        }

    // Routed through the Express API (PATCH /api/notifications/settings)
    // rather than a direct Firestore write so the field is rate-limited
    // (writeLimiter) and audited consistently with other settings updates.
    // The Firestore rule blocks direct client writes to pmNotificationsEnabled.
    override suspend fun setPmNotificationsEnabled(
        userId: String,
        enabled: Boolean,
    ): Resource<Unit> =
        firebaseCall<Unit>("Failed to update notification setting") {
            api.patch(
                "/api/notifications/settings",
                JSONObject().apply {
                    put("pmNotificationsEnabled", enabled)
                },
            )
        }

    override suspend fun getPmNotificationsEnabled(userId: String): Resource<Boolean> =
        firebaseCall("Failed to get notification setting") {
            // Through the API (EPIC-0006). The PATCH above was already behind
            // it; only this read was not — setter migrated, getter left on a
            // direct Firestore connection.
            //
            // `userId` is ignored on purpose: the endpoint answers for the
            // CALLER, because honouring an id here would let anybody read
            // anybody's settings.
            val json = api.get("/api/notifications/settings")
            json.optBoolean("pmNotificationsEnabled", true)
        }
}
