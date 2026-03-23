package com.shyden.shytalk.data.remote

import android.content.Context
import com.shyden.shytalk.BuildConfig
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.toMap

class AndroidAppConfigService(
    private val context: Context,
    private val api: WorkerApiClient,
) : AppConfigService {
    override val currentVersionCode: Int = BuildConfig.VERSION_CODE

    override suspend fun getLatestVersionInfo(): Resource<Triple<Int, Int, String>> =
        try {
            val json = api.get("/api/config/app")
            val data = json.toMap()
            val minVersionCode = (data["minVersionCode"] as? Number)?.toInt() ?: 0
            val latestVersionCode = (data["latestVersionCode"] as? Number)?.toInt() ?: 0
            val latestVersionName = data["latestVersionName"] as? String ?: ""
            Resource.Success(Triple(minVersionCode, latestVersionCode, latestVersionName))
        } catch (e: Exception) {
            Resource.Error("Failed to check for updates")
        }

    override suspend fun checkBackendHealth(): Resource<BackendHealthStatus> =
        try {
            val json = api.getPublic("/api/health")
            val data = json.toMap()
            Resource.Success(
                BackendHealthStatus(
                    status = data["status"] as? String ?: "ok",
                    firestoreAvailable = data["firestoreAvailable"] as? Boolean ?: true,
                    timestamp = (data["timestamp"] as? Number)?.toLong() ?: System.currentTimeMillis(),
                ),
            )
        } catch (e: Exception) {
            // If we can't reach the health endpoint at all (429, network error, etc.),
            // the backend is effectively degraded
            Resource.Success(
                BackendHealthStatus(
                    status = "degraded",
                    firestoreAvailable = false,
                    timestamp = System.currentTimeMillis(),
                ),
            )
        }

    @Suppress("UNCHECKED_CAST")
    override suspend fun getStartingScreens(): Resource<Map<String, StartingScreen>> =
        try {
            // MUST use getPublic — this endpoint is pre-auth, no Firebase user exists yet.
            val json = api.getPublic("/api/config/startingScreens")
            val data = json.toMap()
            val screens = mutableMapOf<String, StartingScreen>()
            for ((id, value) in data) {
                val screenMap = (value as? Map<String, Any?>) ?: continue
                screens[id] =
                    StartingScreen(
                        screenId = id,
                        enabled = screenMap["enabled"] as? Boolean ?: false,
                        dismissable = screenMap["dismissable"] as? Boolean ?: true,
                        frequency = screenMap["frequency"] as? String ?: "every_launch",
                        template = screenMap["template"] as? String ?: "info",
                        title = screenMap["title"] as? String ?: "",
                        message = screenMap["message"] as? String ?: "",
                        imageType = screenMap["imageType"] as? String,
                        backgroundImage = screenMap["backgroundImage"] as? String,
                        startDate = screenMap["startDate"] as? String,
                        endDate = screenMap["endDate"] as? String,
                        contentHash = screenMap["contentHash"] as? String ?: "",
                    )
            }
            Resource.Success(screens)
        } catch (e: Exception) {
            Resource.Error("Failed to fetch starting screens")
        }

    override fun getCacheSizeBytes(): Long =
        context.cacheDir
            .walkTopDown()
            .filter { it.isFile }
            .sumOf { it.length() }

    override fun clearAppCache() {
        context.cacheDir.listFiles()?.forEach { file -> file.deleteRecursively() }
    }
}
