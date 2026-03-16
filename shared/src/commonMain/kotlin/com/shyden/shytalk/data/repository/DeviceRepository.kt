package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource

data class BanStatus(
    val isBanned: Boolean = false,
    val banType: String? = null,
    val reason: String? = null,
    val expiresAt: String? = null,
)

interface DeviceRepository {
    suspend fun getDeviceBinding(deviceId: String): Resource<String?>

    suspend fun bindDevice(
        deviceId: String,
        userId: String,
    ): Resource<Unit>

    suspend fun checkBanStatus(deviceId: String): Resource<BanStatus>
}
