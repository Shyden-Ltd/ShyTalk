package com.shyden.shytalk.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import kotlinx.coroutines.tasks.await

class DeviceRepositoryImpl(
    private val firestore: FirebaseFirestore
) : DeviceRepository {

    override suspend fun getDeviceBinding(deviceId: String): Resource<String?> = firebaseCall("Failed to check device binding") {
        val doc = firestore.document("deviceBindings/$deviceId").get().await()
        val data = doc.data ?: return@firebaseCall null
        data["userId"] as? String
    }

    override suspend fun bindDevice(deviceId: String, userId: String): Resource<Unit> = firebaseCall("Failed to bind device") {
        firestore.document("deviceBindings/$deviceId").set(
            mapOf(
                "userId" to userId,
                "boundAt" to System.currentTimeMillis()
            )
        ).await()
    }
}
