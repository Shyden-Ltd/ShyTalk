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

    override fun clearAppCache() {
        context.cacheDir.listFiles()?.forEach { file -> file.deleteRecursively() }
    }
}
