@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package com.shyden.shytalk.core.util

import kotlinx.cinterop.addressOf
import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.usePinned
import kotlinx.cinterop.value
import platform.CoreFoundation.CFDictionaryCreateMutable
import platform.CoreFoundation.CFDictionarySetValue
import platform.CoreFoundation.CFMutableDictionaryRef
import platform.CoreFoundation.CFTypeRef
import platform.CoreFoundation.CFTypeRefVar
import platform.CoreFoundation.kCFBooleanTrue
import platform.Foundation.CFBridgingRelease
import platform.Foundation.CFBridgingRetain
import platform.Foundation.NSData
import platform.Foundation.create
import platform.Security.SecItemAdd
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.errSecItemNotFound
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
private const val TAG = "SecureStorage"

actual class SecureStorage {
    private fun createQuery(
        key: String,
        extras: Map<CFTypeRef?, CFTypeRef?> = emptyMap(),
    ): CFMutableDictionaryRef {
        val dict = CFDictionaryCreateMutable(null, 0, null, null)!!
        CFDictionarySetValue(dict, kSecClass, kSecClassGenericPassword)
        CFDictionarySetValue(dict, kSecAttrService, CFBridgingRetain(SERVICE_NAME))
        CFDictionarySetValue(dict, kSecAttrAccount, CFBridgingRetain(key))
        for ((k, v) in extras) {
            CFDictionarySetValue(dict, k, v)
        }
        return dict
    }

    actual fun getString(key: String): String? {
        val query =
            createQuery(
                key,
                mapOf(
                    kSecReturnData to kCFBooleanTrue,
                    kSecMatchLimit to kSecMatchLimitOne,
                ),
            )
        memScoped {
            val result = alloc<CFTypeRefVar>()
            val status = SecItemCopyMatching(query, result.ptr)
            if (status != errSecSuccess) {
                // errSecItemNotFound is the ordinary miss; anything else is a read that failed.
                if (status != errSecItemNotFound) logW(TAG, "getString: SecItemCopyMatching failed for '$key', OSStatus=$status")
                return null
            }
            // SecItemCopyMatching hands back a +1 CoreFoundation reference. Kotlin/Native
            // sees a raw pointer, and `pointer as? NSData` is a check on the Kotlin wrapper
            // that never passes (the compiler said so; it was suppressed, and every Keychain
            // read on iOS missed — SHY-0500). CFBridgingRelease crosses the toll-free bridge
            // to the NSData it really is and balances the +1.
            val data = CFBridgingRelease(result.value) as? NSData
            if (data == null) {
                logW(TAG, "getString: SecItemCopyMatching returned something other than data for '$key'")
                return null
            }
            return data.toByteArray().decodeToString()
        }
    }

    actual fun putString(
        key: String,
        value: String,
    ) {
        delete(key)
        val bytes = value.encodeToByteArray()
        if (bytes.isEmpty()) return
        val data =
            bytes.usePinned { pinned ->
                NSData.create(bytes = pinned.addressOf(0), length = bytes.size.toULong())
            }
        val query =
            createQuery(
                key,
                mapOf(kSecValueData to CFBridgingRetain(data)),
            )
        val status = SecItemAdd(query, null)
        if (status != errSecSuccess) logW(TAG, "putString: SecItemAdd failed for '$key', OSStatus=$status")
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

    /**
     * Deletes every item this app owns under [SERVICE_NAME].
     *
     * Deliberately NOT `ALL_KEYS.forEach { delete(it) }`. That list is
     * hand-maintained, and it had already drifted: SHY-0143 added three
     * `session_cache_*` keys that a `clear()` would have left behind — on the
     * one platform where the Keychain SURVIVES app deletion, so the leftovers
     * outlive the uninstall. A list you must remember to update is a list that
     * will be wrong again.
     *
     * Omitting `kSecAttrAccount` from the query makes it match every item for
     * the service, which is what "clear" is supposed to mean. `errSecItemNotFound`
     * on an already-empty keychain is success, not failure.
     */
    actual fun clear() {
        val dict = CFDictionaryCreateMutable(null, 0, null, null)!!
        CFDictionarySetValue(dict, kSecClass, kSecClassGenericPassword)
        CFDictionarySetValue(dict, kSecAttrService, CFBridgingRetain(SERVICE_NAME))
        val status = SecItemDelete(dict)
        if (status != errSecSuccess && status != errSecItemNotFound) logW(TAG, "clear: SecItemDelete failed, OSStatus=$status")
    }

    private fun delete(key: String) {
        val query = createQuery(key)
        val status = SecItemDelete(query)
        if (status != errSecSuccess && status != errSecItemNotFound) logW(TAG, "delete: SecItemDelete failed for '$key', OSStatus=$status")
    }
}
