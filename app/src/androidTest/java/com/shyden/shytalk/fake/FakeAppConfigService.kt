package com.shyden.shytalk.fake

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.AppConfigService

class FakeAppConfigService : AppConfigService {
    override val currentVersionCode: Int = 40

    override suspend fun getLatestVersionInfo(): Resource<Pair<Int, String>> =
        Resource.Success(40 to "0.40")

    override fun clearAppCache() { /* no-op */ }
}
