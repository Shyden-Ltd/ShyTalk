package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.Banner
import com.shyden.shytalk.core.util.toMap
import com.shyden.shytalk.data.remote.WorkerApiClient

/**
 * Banners, through the API (EPIC-0006).
 *
 * Was a direct Firestore query — `banners` where `isActive`, then date-filtered
 * and sorted on the phone. `GET /api/banners/active` already did exactly that
 * server-side, so this needed no new endpoint: only for somebody to notice the
 * client was doing the work twice, on a connection it should not have had.
 */
class BannerRepositoryImpl(
    private val api: WorkerApiClient,
) : BannerRepository {
    override suspend fun getActiveBanners(): List<Banner> {
        val arr = api.getArray("/api/banners/active")
        return (0 until arr.length())
            .mapNotNull { i ->
                val obj = arr.optJSONObject(i) ?: return@mapNotNull null
                val id = obj.optString("id")
                if (id.isEmpty()) return@mapNotNull null
                Banner.fromMap(obj.toMap(), id)
            }
            // The server already orders by sortOrder; kept so display order is a
            // property of this list rather than of the transport that fetched it.
            .sortedBy { it.sortOrder }
    }
}
