package com.shyden.shytalk.feature.splash

fun interface WebContentPreloader {
    suspend fun preload(url: String)
}
