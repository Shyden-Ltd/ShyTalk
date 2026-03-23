package com.shyden.shytalk.feature.splash

import android.content.Context
import coil3.SingletonImageLoader
import coil3.request.ImageRequest

class CoilBannerImagePreloader(
    private val context: Context,
) : BannerImagePreloader {
    override suspend fun preload(url: String) {
        val loader = SingletonImageLoader.get(context)
        loader.execute(
            ImageRequest
                .Builder(context)
                .data(url)
                .build(),
        )
    }
}
