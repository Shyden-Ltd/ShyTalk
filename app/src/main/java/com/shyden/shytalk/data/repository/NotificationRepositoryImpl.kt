package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.push.PushIdentifier
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.data.remote.WorkerApiClient
import org.json.JSONObject

class NotificationRepositoryImpl(
    private val api: WorkerApiClient,
) : NotificationRepository {
    /**
     * SHY-0244 — the body names the model so the backend files the value in
     * the right store. Both kinds are opaque strings the server cannot tell
     * apart, so the client is the only place that knows which this is.
     */
    private fun body(identifier: PushIdentifier) =
        JSONObject().apply {
            put(if (identifier.isInstallationId) "installationId" else "token", identifier.value)
        }

    override suspend fun savePushIdentifier(
        userId: String,
        identifier: PushIdentifier,
    ): Resource<Unit> =
        firebaseCall<Unit>("Failed to save push identifier") {
            api.post("/api/notifications/token", body(identifier))
        }

    override suspend fun removePushIdentifier(
        userId: String,
        identifier: PushIdentifier,
    ): Resource<Unit> =
        firebaseCall<Unit>("Failed to remove push identifier") {
            api.delete("/api/notifications/token", body(identifier))
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
