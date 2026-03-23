package com.shyden.shytalk.fake

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.AppConfigService
import com.shyden.shytalk.data.remote.BackendHealthStatus
import com.shyden.shytalk.data.remote.StartingScreen

class FakeAppConfigService : AppConfigService {
    override val currentVersionCode: Int = 40

    var startingScreens: Resource<Map<String, StartingScreen>> = Resource.Success(emptyMap())

    override suspend fun getLatestVersionInfo(): Resource<Triple<Int, Int, String>> = Resource.Success(Triple(1, 40, "0.40"))

    override suspend fun checkBackendHealth(): Resource<BackendHealthStatus> =
        Resource.Success(BackendHealthStatus("ok", true, System.currentTimeMillis()))

    override suspend fun getStartingScreens(): Resource<Map<String, StartingScreen>> = startingScreens

    override fun getCacheSizeBytes(): Long = 0L

    override fun clearAppCache() { /* no-op */ }
}
