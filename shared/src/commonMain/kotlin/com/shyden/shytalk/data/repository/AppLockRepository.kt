package com.shyden.shytalk.data.repository

interface AppLockRepository {
    val hasCredential: Boolean
    val isAppLockEnabled: Boolean
    val isBiometricEnabled: Boolean
    val lockTimeoutMinutes: Int
    val storedUniqueId: String?
    val storedDeviceId: String?
    val localPinHash: String?
    val credentialVersion: Int

    fun setCredential(
        uniqueId: String,
        deviceId: String,
        localPinHash: String,
    )

    fun setAppLockEnabled(enabled: Boolean)

    fun setBiometricEnabled(enabled: Boolean)

    fun setLockTimeoutMinutes(minutes: Int)

    fun updateLastActiveTimestamp()

    fun isLockRequired(): Boolean

    fun clearCredential()
}
