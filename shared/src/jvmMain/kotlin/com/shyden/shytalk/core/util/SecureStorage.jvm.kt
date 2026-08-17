package com.shyden.shytalk.core.util

/**
 * JVM stub for SecureStorage — used only for running commonTest on desktop.
 * Uses an in-memory map (not persistent).
 */
actual class SecureStorage {
    // ConcurrentHashMap, not mutableMapOf. SHY-0143's concurrency tests drive
    // this from several threads, and the contract test's KDoc claims it has
    // "the same read/write/remove semantics" as Android's synchronized
    // SharedPreferences and the thread-safe iOS Keychain. A plain LinkedHashMap
    // made that claim false — the tests could flake on a HashMap data race and
    // could not prove anything about either shipping actual.
    private val store = java.util.concurrent.ConcurrentHashMap<String, String>()

    actual fun getString(key: String): String? = store[key]

    actual fun putString(
        key: String,
        value: String,
    ) {
        store[key] = value
    }

    actual fun getInt(
        key: String,
        default: Int,
    ): Int = store[key]?.toIntOrNull() ?: default

    actual fun putInt(
        key: String,
        value: Int,
    ) {
        store[key] = value.toString()
    }

    actual fun getBoolean(
        key: String,
        default: Boolean,
    ): Boolean = store[key]?.toBooleanStrictOrNull() ?: default

    actual fun putBoolean(
        key: String,
        value: Boolean,
    ) {
        store[key] = value.toString()
    }

    actual fun getLong(
        key: String,
        default: Long,
    ): Long = store[key]?.toLongOrNull() ?: default

    actual fun putLong(
        key: String,
        value: Long,
    ) {
        store[key] = value.toString()
    }

    actual fun remove(key: String) {
        store.remove(key)
    }

    actual fun clear() {
        store.clear()
    }
}
