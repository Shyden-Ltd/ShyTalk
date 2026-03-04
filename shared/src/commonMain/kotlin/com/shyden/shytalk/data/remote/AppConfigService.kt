package com.shyden.shytalk.data.remote

import com.shyden.shytalk.core.util.Resource

data class BackendHealthStatus(
    val status: String,
    val firestoreAvailable: Boolean,
    val timestamp: Long
)

interface AppConfigService {
    val currentVersionCode: Int
    /** Returns (minVersionCode, latestVersionCode, latestVersionName). */
    suspend fun getLatestVersionInfo(): Resource<Triple<Int, Int, String>>
    suspend fun checkBackendHealth(): Resource<BackendHealthStatus>
    fun getCacheSizeBytes(): Long
    fun clearAppCache()
}
