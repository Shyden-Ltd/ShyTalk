package com.shyden.shytalk.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.model.Banner
import kotlinx.coroutines.tasks.await

class BannerRepositoryImpl(
    private val firestore: FirebaseFirestore,
) : BannerRepository {
    override suspend fun getActiveBanners(): List<Banner> {
        val now = System.currentTimeMillis()
        val snapshot =
            firestore
                .collection("banners")
                .whereEqualTo("isActive", true)
                .get()
                .await()
        return snapshot.documents
            .mapNotNull { doc ->
                val data = doc.data ?: return@mapNotNull null
                val startDate = (data["startDate"] as? Long) ?: 0L
                val endDate = (data["endDate"] as? Long) ?: Long.MAX_VALUE
                if (startDate > now || endDate < now) return@mapNotNull null
                Banner.fromMap(data, doc.id)
            }.sortedBy { it.sortOrder }
    }
}
