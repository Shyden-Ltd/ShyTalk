package com.shyden.shytalk.fake

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.DeviceRepository

class FakeDeviceRepository : DeviceRepository {
    private val bindings = mutableMapOf<String, String>()

    override suspend fun getDeviceBinding(deviceId: String): Resource<String?> =
        Resource.Success(bindings[deviceId])

    override suspend fun bindDevice(deviceId: String, userId: String): Resource<Unit> {
        bindings[deviceId] = userId
        return Resource.Success(Unit)
    }
}
