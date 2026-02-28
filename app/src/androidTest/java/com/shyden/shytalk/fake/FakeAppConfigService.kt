package com.shyden.shytalk.fake

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.AppConfigService

class FakeAppConfigService : AppConfigService {
    override val currentVersionCode: Int = 40

    override suspend fun getLatestVersionInfo(): Resource<Triple<Int, Int, String>> =
        Resource.Success(Triple(1, 40, "0.40"))

    override fun clearAppCache() { /* no-op */ }
}
