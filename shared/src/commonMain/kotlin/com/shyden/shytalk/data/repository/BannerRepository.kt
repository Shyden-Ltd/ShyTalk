package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.Banner

fun interface BannerRepository {
    suspend fun getActiveBanners(): List<Banner>
}
