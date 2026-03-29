package com.shyden.shytalk.feature.splash

fun interface BannerImagePreloader {
    suspend fun preload(url: String)
}
