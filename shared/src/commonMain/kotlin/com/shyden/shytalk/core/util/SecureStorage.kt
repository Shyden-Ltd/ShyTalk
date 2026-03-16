package com.shyden.shytalk.core.util

/**
 * Platform-specific secure key-value storage.
 * Android: EncryptedSharedPreferences (AES-256-GCM).
 * iOS: Keychain (kSecClassGenericPassword).
 */
expect class SecureStorage {
    fun getString(key: String): String?

    fun putString(
        key: String,
        value: String,
    )

    fun getInt(
        key: String,
        default: Int,
    ): Int

    fun putInt(
        key: String,
        value: Int,
    )

    fun getBoolean(
        key: String,
        default: Boolean,
    ): Boolean

    fun putBoolean(
        key: String,
        value: Boolean,
    )

    fun getLong(
        key: String,
        default: Long,
    ): Long

    fun putLong(
        key: String,
        value: Long,
    )

    fun remove(key: String)

    fun clear()
}
