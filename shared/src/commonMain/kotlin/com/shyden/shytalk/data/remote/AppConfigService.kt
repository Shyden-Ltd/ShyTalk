package com.shyden.shytalk.data.remote

import com.shyden.shytalk.core.util.Resource

interface AppConfigService {
    val currentVersionCode: Int
    /** Returns (minVersionCode, latestVersionCode, latestVersionName). */
    suspend fun getLatestVersionInfo(): Resource<Triple<Int, Int, String>>
    fun clearAppCache()
}
