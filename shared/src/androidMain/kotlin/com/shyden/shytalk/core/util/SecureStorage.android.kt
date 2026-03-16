package com.shyden.shytalk.core.util

import android.content.Context
import android.content.SharedPreferences
import android.util.Log
import androidx.security.crypto.EncryptedSharedPreferences
import androidx.security.crypto.MasterKey

actual class SecureStorage(
    context: Context,
) {
    private val prefs: SharedPreferences =
        try {
            createEncryptedPrefs(context)
        } catch (e: Exception) {
            // Corruption recovery (e.g. API 28 Keystore issue): clear and recreate
            Log.e("SecureStorage", "EncryptedSharedPreferences failed, attempting recovery", e)
            context
                .getSharedPreferences(PREFS_NAME, Context.MODE_PRIVATE)
                .edit()
                .clear()
                .apply()
            try {
                createEncryptedPrefs(context)
            } catch (e2: Exception) {
                // Cannot create encrypted storage — return empty read-only prefs
                // This forces a fresh sign-in (hasCredential will return false)
                Log.e("SecureStorage", "Recovery failed — credentials will be treated as absent", e2)
                EmptySharedPreferences()
            }
        }

    private companion object {
        const val PREFS_NAME = "shytalk_secure_prefs"

        fun createEncryptedPrefs(context: Context): SharedPreferences {
            val masterKey =
                MasterKey
                    .Builder(context)
                    .setKeyScheme(MasterKey.KeyScheme.AES256_GCM)
                    .build()
            return EncryptedSharedPreferences.create(
                context,
                PREFS_NAME,
                masterKey,
                EncryptedSharedPreferences.PrefKeyEncryptionScheme.AES256_SIV,
                EncryptedSharedPreferences.PrefValueEncryptionScheme.AES256_GCM,
            )
        }
    }

    actual fun getString(key: String): String? = prefs.getString(key, null)

    actual fun putString(
        key: String,
        value: String,
    ) {
        prefs.edit().putString(key, value).apply()
    }

    actual fun getInt(
        key: String,
        default: Int,
    ): Int = prefs.getInt(key, default)

    actual fun putInt(
        key: String,
        value: Int,
    ) {
        prefs.edit().putInt(key, value).apply()
    }

    actual fun getBoolean(
        key: String,
        default: Boolean,
    ): Boolean = prefs.getBoolean(key, default)

    actual fun putBoolean(
        key: String,
        value: Boolean,
    ) {
        prefs.edit().putBoolean(key, value).apply()
    }

    actual fun getLong(
        key: String,
        default: Long,
    ): Long = prefs.getLong(key, default)

    actual fun putLong(
        key: String,
        value: Long,
    ) {
        prefs.edit().putLong(key, value).apply()
    }

    actual fun remove(key: String) {
        prefs.edit().remove(key).apply()
    }

    actual fun clear() {
        prefs.edit().clear().apply()
    }
}

/**
 * Read-only SharedPreferences that always returns defaults.
 * Used when encrypted storage cannot be created — forces fresh sign-in.
 */
private class EmptySharedPreferences : SharedPreferences {
    override fun getAll(): Map<String, *> = emptyMap<String, Any>()

    override fun getString(
        key: String?,
        defValue: String?,
    ): String? = defValue

    override fun getStringSet(
        key: String?,
        defValues: Set<String>?,
    ): Set<String>? = defValues

    override fun getInt(
        key: String?,
        defValue: Int,
    ): Int = defValue

    override fun getLong(
        key: String?,
        defValue: Long,
    ): Long = defValue

    override fun getFloat(
        key: String?,
        defValue: Float,
    ): Float = defValue

    override fun getBoolean(
        key: String?,
        defValue: Boolean,
    ): Boolean = defValue

    override fun contains(key: String?): Boolean = false

    override fun edit(): SharedPreferences.Editor = NoOpEditor()

    override fun registerOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}

    override fun unregisterOnSharedPreferenceChangeListener(listener: SharedPreferences.OnSharedPreferenceChangeListener?) {}
}

private class NoOpEditor : SharedPreferences.Editor {
    override fun putString(
        key: String?,
        value: String?,
    ) = this

    override fun putStringSet(
        key: String?,
        values: Set<String>?,
    ) = this

    override fun putInt(
        key: String?,
        value: Int,
    ) = this

    override fun putLong(
        key: String?,
        value: Long,
    ) = this

    override fun putFloat(
        key: String?,
        value: Float,
    ) = this

    override fun putBoolean(
        key: String?,
        value: Boolean,
    ) = this

    override fun remove(key: String?) = this

    override fun clear() = this

    override fun commit(): Boolean = true

    override fun apply() {}
}
