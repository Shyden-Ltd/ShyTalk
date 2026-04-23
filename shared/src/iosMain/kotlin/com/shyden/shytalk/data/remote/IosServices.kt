package com.shyden.shytalk.data.remote

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.boolean
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.int
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.long

// ── TokenService (LiveKit) ──────────────────────────────────────

class IosTokenServiceImpl(
    private val api: IosApiClient,
) : TokenService {
    override suspend fun fetchToken(roomName: String): TokenResponse {
        val response =
            api.post(
                "/api/livekit/token",
                JsonObject(mapOf("roomName" to JsonPrimitive(roomName))),
            )
        val token =
            response["token"]
                ?.jsonPrimitive
                ?.contentOrNull
                ?.takeIf { it.isNotEmpty() }
                ?: throw IllegalStateException("Invalid token response from server")
        val url = response["url"]?.jsonPrimitive?.contentOrNull?.takeIf { it.isNotEmpty() }
        return TokenResponse(token = token, url = url)
    }
}

// ── AppConfigService ────────────────────────────────────────────

class IosAppConfigServiceImpl(
    private val api: IosApiClient,
) : AppConfigService {
    override val currentVersionCode: Int = 1 // iOS doesn't use version codes the same way

    override suspend fun getLatestVersionInfo(): Resource<Triple<Int, Int, String>> =
        try {
            val json = api.get("/api/config/app")
            val minVersionCode = json["minVersionCode"]?.jsonPrimitive?.int ?: 0
            val latestVersionCode = json["latestVersionCode"]?.jsonPrimitive?.int ?: 0
            val latestVersionName = json["latestVersionName"]?.jsonPrimitive?.contentOrNull ?: ""
            Resource.Success(Triple(minVersionCode, latestVersionCode, latestVersionName))
        } catch (e: Exception) {
            Resource.Error("Failed to check for updates")
        }

    override suspend fun checkBackendHealth(): Resource<BackendHealthStatus> =
        try {
            val json = api.getPublic("/api/health")
            Resource.Success(
                BackendHealthStatus(
                    status = json["status"]?.jsonPrimitive?.contentOrNull ?: "ok",
                    firestoreAvailable = json["firestoreAvailable"]?.jsonPrimitive?.boolean ?: true,
                    timestamp = json["timestamp"]?.jsonPrimitive?.long ?: currentTimeMillis(),
                ),
            )
        } catch (e: Exception) {
            Resource.Success(
                BackendHealthStatus(
                    status = "degraded",
                    firestoreAvailable = false,
                    timestamp = currentTimeMillis(),
                ),
            )
        }

    @Suppress("UNCHECKED_CAST")
    override suspend fun getStartingScreens(): Resource<Map<String, StartingScreen>> =
        try {
            val json = api.getPublic("/api/config/startingScreens")
            val screens = mutableMapOf<String, StartingScreen>()
            for ((id, value) in json) {
                val screenObj = value as? kotlinx.serialization.json.JsonObject ?: continue
                screens[id] =
                    StartingScreen(
                        screenId = id,
                        enabled = screenObj["enabled"]?.jsonPrimitive?.boolean ?: false,
                        dismissable = screenObj["dismissable"]?.jsonPrimitive?.boolean ?: true,
                        frequency = screenObj["frequency"]?.jsonPrimitive?.contentOrNull ?: "every_launch",
                        template = screenObj["template"]?.jsonPrimitive?.contentOrNull ?: "info",
                        title = screenObj["title"]?.jsonPrimitive?.contentOrNull ?: "",
                        message = screenObj["message"]?.jsonPrimitive?.contentOrNull ?: "",
                        imageType = screenObj["imageType"]?.jsonPrimitive?.contentOrNull,
                        backgroundImage = screenObj["backgroundImage"]?.jsonPrimitive?.contentOrNull,
                        startDate = screenObj["startDate"]?.jsonPrimitive?.contentOrNull,
                        endDate = screenObj["endDate"]?.jsonPrimitive?.contentOrNull,
                        contentHash = screenObj["contentHash"]?.jsonPrimitive?.contentOrNull ?: "",
                    )
            }
            Resource.Success(screens)
        } catch (e: Exception) {
            Resource.Error("Failed to fetch starting screens")
        }

    override fun getCacheSizeBytes(): Long = 0L // iOS cache management is different

    override fun clearAppCache() {
        // iOS cache clearing handled at app level, not here
    }
}
