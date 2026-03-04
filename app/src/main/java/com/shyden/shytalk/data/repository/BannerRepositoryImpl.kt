package com.shyden.shytalk.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.model.Banner
import kotlinx.coroutines.tasks.await

class BannerRepositoryImpl(
    private val firestore: FirebaseFirestore
) : BannerRepository {

    override suspend fun getActiveBanners(): List<Banner> {
        val now = System.currentTimeMillis()
        val snapshot = firestore.collection("banners")
            .whereEqualTo("isActive", true)
            .whereLessThanOrEqualTo("startDate", now)
            .get()
            .await()
        return snapshot.documents
            .mapNotNull { doc ->
                val data = doc.data ?: return@mapNotNull null
                // Filter out expired banners client-side (Firestore can't do AND on two range fields)
                val endDate = (data["endDate"] as? Long) ?: Long.MAX_VALUE
                if (endDate < now) return@mapNotNull null
                Banner.fromMap(data, doc.id)
            }
            .sortedBy { it.sortOrder }
    }
}
