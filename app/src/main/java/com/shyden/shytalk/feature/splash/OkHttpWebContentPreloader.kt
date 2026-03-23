package com.shyden.shytalk.feature.splash

import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import okhttp3.OkHttpClient
import okhttp3.Request

class OkHttpWebContentPreloader(
    private val client: OkHttpClient,
) : WebContentPreloader {
    override suspend fun preload(url: String) {
        withContext(Dispatchers.IO) {
            val request = Request.Builder().url(url).build()
            client.newCall(request).execute().close()
        }
    }
}
