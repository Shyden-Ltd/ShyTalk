package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.SecureStorage
import com.shyden.shytalk.core.util.currentTimeMillis

class AppLockRepositoryImpl(
    private val storage: SecureStorage,
) : AppLockRepository {
    override val hasCredential: Boolean
        get() = storage.getString(KEY_UNIQUE_ID) != null

    override val isAppLockEnabled: Boolean
        get() = storage.getBoolean(KEY_APP_LOCK_ENABLED, true) // default on

    override val isBiometricEnabled: Boolean
        get() = storage.getBoolean(KEY_BIOMETRIC_ENABLED, false)

    override val lockTimeoutMinutes: Int
        get() = storage.getInt(KEY_LOCK_TIMEOUT, 5) // default 5 min

    override val storedUniqueId: String?
        get() = storage.getString(KEY_UNIQUE_ID)

    override val storedDeviceId: String?
        get() = storage.getString(KEY_DEVICE_ID)

    override val localPinHash: String?
        get() = storage.getString(KEY_LOCAL_PIN_HASH)

    override val credentialVersion: Int
        get() = storage.getInt(KEY_CREDENTIAL_VERSION, 0)

    override fun setCredential(
        uniqueId: String,
        deviceId: String,
        localPinHash: String,
    ) {
        storage.putString(KEY_UNIQUE_ID, uniqueId)
        storage.putString(KEY_DEVICE_ID, deviceId)
        storage.putString(KEY_LOCAL_PIN_HASH, localPinHash)
        storage.putInt(KEY_CREDENTIAL_VERSION, CURRENT_CREDENTIAL_VERSION)
        updateLastActiveTimestamp()
    }

    override fun setAppLockEnabled(enabled: Boolean) {
        storage.putBoolean(KEY_APP_LOCK_ENABLED, enabled)
    }

    override fun setBiometricEnabled(enabled: Boolean) {
        storage.putBoolean(KEY_BIOMETRIC_ENABLED, enabled)
    }

    override fun setLockTimeoutMinutes(minutes: Int) {
        storage.putInt(KEY_LOCK_TIMEOUT, minutes)
    }

    override fun updateLastActiveTimestamp() {
        storage.putLong(KEY_LAST_ACTIVE, currentTimeMillis())
    }

    override fun isLockRequired(): Boolean {
        if (!isAppLockEnabled) return false
        val timeout = lockTimeoutMinutes
        if (timeout <= 0) return false // "Never" timeout
        val lastActive = storage.getLong(KEY_LAST_ACTIVE, 0L)
        if (lastActive == 0L) return true // No timestamp = require lock
        val elapsed = currentTimeMillis() - lastActive
        return elapsed > timeout * 60 * 1000L
    }

    override fun clearCredential() {
        storage.remove(KEY_UNIQUE_ID)
        storage.remove(KEY_DEVICE_ID)
        storage.remove(KEY_LOCAL_PIN_HASH)
        storage.remove(KEY_CREDENTIAL_VERSION)
        storage.remove(KEY_APP_LOCK_ENABLED)
        storage.remove(KEY_BIOMETRIC_ENABLED)
        storage.remove(KEY_LOCK_TIMEOUT)
        storage.remove(KEY_LAST_ACTIVE)
    }

    companion object {
        private const val CURRENT_CREDENTIAL_VERSION = 1
        private const val KEY_UNIQUE_ID = "uniqueId"
        private const val KEY_DEVICE_ID = "deviceId"
        private const val KEY_LOCAL_PIN_HASH = "localPinHash"
        private const val KEY_CREDENTIAL_VERSION = "credentialVersion"
        private const val KEY_APP_LOCK_ENABLED = "appLockEnabled"
        private const val KEY_BIOMETRIC_ENABLED = "biometricEnabled"
        private const val KEY_LOCK_TIMEOUT = "lockTimeoutMinutes"
        private const val KEY_LAST_ACTIVE = "lastActiveTimestamp"
    }
}
