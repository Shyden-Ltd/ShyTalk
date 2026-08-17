package com.shyden.shytalk.core.util

/**
 * Platform-specific key-value storage for credential and session state.
 *
 * - **Android:** plain `SharedPreferences` with `MODE_PRIVATE`, protected by
 *   the app sandbox and device file-based encryption. It is deliberately NOT
 *   `EncryptedSharedPreferences` — AndroidX deprecated that, and
 *   `SecureStorage.android.kt` carries the full rationale plus the one-time
 *   migration off the legacy encrypted file. This KDoc claimed AES-256-GCM
 *   long after that stopped being true, and the claim was copied into
 *   SHY-0143's `SessionCache` on the strength of it.
 * - **iOS:** Keychain (`kSecClassGenericPassword`). Note it SURVIVES app
 *   deletion, so a reinstall can inherit the previous install's values.
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
