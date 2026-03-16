@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package com.shyden.shytalk.core.util

import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.value
import platform.CoreFoundation.CFDictionaryRef
import platform.Foundation.NSData
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.create
import platform.Foundation.dataUsingEncoding
import platform.Security.SecItemAdd
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.errSecSuccess
import platform.Security.kSecAttrAccount
import platform.Security.kSecAttrService
import platform.Security.kSecClass
import platform.Security.kSecClassGenericPassword
import platform.Security.kSecMatchLimit
import platform.Security.kSecMatchLimitOne
import platform.Security.kSecReturnData
import platform.Security.kSecValueData

private const val SERVICE_NAME = "com.shyden.shytalk.secure"

private val ALL_KEYS =
    listOf(
        "credentialVersion",
        "uniqueId",
        "deviceId",
        "appLockEnabled",
        "biometricEnabled",
        "lockTimeoutMinutes",
        "lastActiveTimestamp",
        "localPinHash",
    )

@Suppress("UNCHECKED_CAST")
actual class SecureStorage {
    actual fun getString(key: String): String? {
        val query =
            mapOf<Any?, Any?>(
                kSecClass to kSecClassGenericPassword,
                kSecAttrService to SERVICE_NAME,
                kSecAttrAccount to key,
                kSecReturnData to true,
                kSecMatchLimit to kSecMatchLimitOne,
            )
        memScoped {
            val result = alloc<kotlinx.cinterop.ObjCObjectVar<Any?>>()
            val status = SecItemCopyMatching(query as CFDictionaryRef, result.ptr)
            if (status != errSecSuccess) return null
            val data = result.value as? NSData ?: return null
            return NSString.create(data = data, encoding = NSUTF8StringEncoding) as? String
        }
    }

    actual fun putString(
        key: String,
        value: String,
    ) {
        delete(key) // remove existing before adding
        val data = (value as NSString).dataUsingEncoding(NSUTF8StringEncoding) ?: return
        val query =
            mapOf<Any?, Any?>(
                kSecClass to kSecClassGenericPassword,
                kSecAttrService to SERVICE_NAME,
                kSecAttrAccount to key,
                kSecValueData to data,
            )
        SecItemAdd(query as CFDictionaryRef, null)
    }

    actual fun getInt(
        key: String,
        default: Int,
    ): Int = getString(key)?.toIntOrNull() ?: default

    actual fun putInt(
        key: String,
        value: Int,
    ) = putString(key, value.toString())

    actual fun getBoolean(
        key: String,
        default: Boolean,
    ): Boolean = getString(key)?.toBooleanStrictOrNull() ?: default

    actual fun putBoolean(
        key: String,
        value: Boolean,
    ) = putString(key, value.toString())

    actual fun getLong(
        key: String,
        default: Long,
    ): Long = getString(key)?.toLongOrNull() ?: default

    actual fun putLong(
        key: String,
        value: Long,
    ) = putString(key, value.toString())

    actual fun remove(key: String) = delete(key)

    actual fun clear() {
        ALL_KEYS.forEach { delete(it) }
    }

    private fun delete(key: String) {
        val query =
            mapOf<Any?, Any?>(
                kSecClass to kSecClassGenericPassword,
                kSecAttrService to SERVICE_NAME,
                kSecAttrAccount to key,
            )
        SecItemDelete(query as CFDictionaryRef)
    }
}
