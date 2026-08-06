package com.shyden.shytalk.data.remote

import com.shyden.shytalk.core.util.Resource

data class BackendHealthStatus(
    val status: String,
    val firestoreAvailable: Boolean,
    val timestamp: Long,
    /**
     * The backend's self-reported deploy sha (`express-api/src/index.js`
     * `/api/health`; `"unknown"` on local where no `.deployed-sha` file
     * exists). Consumed by the preview watermark's server line
     * (SHY-0205) — proves which backend ANSWERED, not just which URL
     * was configured. Null when the endpoint predates the field.
     */
    val sha: String? = null,
)

data class StartingScreen(
    val screenId: String,
    val enabled: Boolean,
    val dismissable: Boolean,
    val frequency: String,
    val template: String,
    val title: String,
    val message: String,
    val imageType: String? = null,
    val backgroundImage: String? = null,
    val startDate: String? = null,
    val endDate: String? = null,
    val contentHash: String = "",
)

interface AppConfigService {
    val currentVersionCode: Int

    /** Returns (minVersionCode, latestVersionCode, latestVersionName). */
    suspend fun getLatestVersionInfo(): Resource<Triple<Int, Int, String>>

    suspend fun checkBackendHealth(): Resource<BackendHealthStatus>

    suspend fun getStartingScreens(): Resource<Map<String, StartingScreen>>

    fun getCacheSizeBytes(): Long

    fun clearAppCache()
}
