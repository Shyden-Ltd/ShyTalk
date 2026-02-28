package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.WorkerApiClient
import org.json.JSONObject

class DeviceRepositoryImpl(
    private val api: WorkerApiClient
) : DeviceRepository {

    override suspend fun getDeviceBinding(deviceId: String): Resource<String?> = firebaseCall("Failed to check device binding") {
        try {
            val json = api.get("/api/device-bindings/$deviceId")
            json.optString("userId", null)
        } catch (e: ApiException) {
            if (e.statusCode == 404) null else throw e
        }
    }

    override suspend fun bindDevice(deviceId: String, userId: String): Resource<Unit> = firebaseCall("Failed to bind device") {
        api.post("/api/device-bindings", JSONObject().apply {
            put("deviceId", deviceId)
            put("userId", userId)
        })
        Unit
    }
}
