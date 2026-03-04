package com.shyden.shytalk.data.remote

import android.content.Context
import com.shyden.shytalk.BuildConfig
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.toMap

class AndroidAppConfigService(
    private val context: Context,
    private val api: WorkerApiClient
) : AppConfigService {

    override val currentVersionCode: Int = BuildConfig.VERSION_CODE

    override suspend fun getLatestVersionInfo(): Resource<Triple<Int, Int, String>> {
        return try {
            val json = api.get("/api/config/app")
            val data = json.toMap()
            val minVersionCode = (data["minVersionCode"] as? Number)?.toInt() ?: 0
            val latestVersionCode = (data["latestVersionCode"] as? Number)?.toInt() ?: 0
            val latestVersionName = data["latestVersionName"] as? String ?: ""
            Resource.Success(Triple(minVersionCode, latestVersionCode, latestVersionName))
        } catch (e: Exception) {
            Resource.Error("Failed to check for updates")
        }
    }

    override suspend fun checkBackendHealth(): Resource<BackendHealthStatus> {
        return try {
            val json = api.get("/api/health")
            val data = json.toMap()
            Resource.Success(BackendHealthStatus(
                status = data["status"] as? String ?: "ok",
                firestoreAvailable = data["firestoreAvailable"] as? Boolean ?: true,
                timestamp = (data["timestamp"] as? Number)?.toLong() ?: System.currentTimeMillis()
            ))
        } catch (e: Exception) {
            // If we can't reach the health endpoint at all (429, network error, etc.),
            // the backend is effectively degraded
            Resource.Success(BackendHealthStatus(
                status = "degraded",
                firestoreAvailable = false,
                timestamp = System.currentTimeMillis()
            ))
        }
    }

    override fun getCacheSizeBytes(): Long {
        return context.cacheDir.walkTopDown().filter { it.isFile }.sumOf { it.length() }
    }

    override fun clearAppCache() {
        context.cacheDir.listFiles()?.forEach { file -> file.deleteRecursively() }
    }
}
