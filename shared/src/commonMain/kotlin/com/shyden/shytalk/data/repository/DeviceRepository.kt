package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource

data class BanStatus(
    val isBanned: Boolean = false,
    val banType: String? = null,
    val reason: String? = null,
    val expiresAt: String? = null,
)

/**
 * Server-authoritative device-lock decision (SHY-0170, EPIC-0006). The
 * "one device ↔ one account" anti-abuse / ban-evasion decision is made by the
 * Express API, never the client — so [LOCKED] means the API determined this
 * device belongs to a different account.
 */
enum class DeviceLockStatus { ALLOWED, LOCKED }

interface DeviceRepository {
    /**
     * Ask the API whether this device is locked to another account. For an
     * existing user on an unbound device the server also binds it (atomically);
     * the client never reads or writes `deviceBindings` directly. Replaces the
     * old client-side getDeviceBinding + bindDevice.
     */
    suspend fun resolveDeviceLock(deviceId: String): Resource<DeviceLockStatus>

    suspend fun checkBanStatus(deviceId: String): Resource<BanStatus>
}
