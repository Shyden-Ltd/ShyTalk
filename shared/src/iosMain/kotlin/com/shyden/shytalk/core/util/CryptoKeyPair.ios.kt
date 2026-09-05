@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package com.shyden.shytalk.core.util

import kotlinx.cinterop.addressOf
import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.reinterpret
import kotlinx.cinterop.usePinned
import kotlinx.cinterop.value
import platform.CoreFoundation.CFDataCreate
import platform.CoreFoundation.CFDataRef
import platform.CoreFoundation.CFDictionaryCreateMutable
import platform.CoreFoundation.CFDictionarySetValue
import platform.CoreFoundation.CFMutableDictionaryRef
import platform.CoreFoundation.CFRelease
import platform.CoreFoundation.CFTypeRefVar
import platform.CoreFoundation.kCFBooleanTrue
import platform.Foundation.CFBridgingRelease
import platform.Foundation.CFBridgingRetain
import platform.Foundation.NSData
import platform.Foundation.NSNumber
import platform.Foundation.base64EncodedStringWithOptions
import platform.Foundation.numberWithInt
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.SecKeyCopyExternalRepresentation
import platform.Security.SecKeyCopyPublicKey
import platform.Security.SecKeyCreateRandomKey
import platform.Security.SecKeyCreateSignature
import platform.Security.SecKeyRef
import platform.Security.errSecItemNotFound
import platform.Security.errSecSuccess
import platform.Security.kSecAttrApplicationTag
import platform.Security.kSecAttrIsPermanent
import platform.Security.kSecAttrKeyClass
import platform.Security.kSecAttrKeyClassPrivate
import platform.Security.kSecAttrKeySizeInBits
import platform.Security.kSecAttrKeyType
import platform.Security.kSecAttrKeyTypeECSECPrimeRandom
import platform.Security.kSecClass
import platform.Security.kSecClassKey
import platform.Security.kSecKeyAlgorithmECDSASignatureMessageX962SHA256
import platform.Security.kSecMatchLimit
import platform.Security.kSecMatchLimitOne
import platform.Security.kSecPrivateKeyAttrs
import platform.Security.kSecReturnRef

private const val TAG = "CryptoKeyPair"
private const val KEY_SIZE_BITS = 256

/**
 * EC P-256 key pair in the iOS Keychain, for biometric challenge signing.
 *
 * Everything here is CoreFoundation, so results come back as raw CF references.
 * Kotlin/Native cannot narrow those with `as?` — that checks the Kotlin pointer
 * wrapper and never passes — so every `CFDataRef` result goes through
 * `CFBridgingRelease`, which crosses the toll-free bridge to the `NSData` it is
 * and balances the +1 that the Copy/Create functions return (SHY-0500 found the
 * same cast defeating every Keychain read in [SecureStorage]). The queries are
 * real `CFDictionary`s for the same reason: a Kotlin `Map` cast to
 * `CFDictionaryRef` is not a dictionary the Security framework can read.
 */
actual class CryptoKeyPair {
    private var currentTag: String? = null

    actual fun generateOrLoad(alias: String): Boolean {
        currentTag = alias
        getPrivateKeyRef(alias)?.let {
            CFRelease(it)
            return true
        }

        val tag = alias.toCFData()
        val keySize = CFBridgingRetain(NSNumber.numberWithInt(KEY_SIZE_BITS))
        val privateKeyAttrs =
            cfDictionary {
                CFDictionarySetValue(it, kSecAttrIsPermanent, kCFBooleanTrue)
                CFDictionarySetValue(it, kSecAttrApplicationTag, tag)
            }
        val attributes =
            cfDictionary {
                CFDictionarySetValue(it, kSecAttrKeyType, kSecAttrKeyTypeECSECPrimeRandom)
                CFDictionarySetValue(it, kSecAttrKeySizeInBits, keySize)
                CFDictionarySetValue(it, kSecPrivateKeyAttrs, privateKeyAttrs)
            }
        val key = SecKeyCreateRandomKey(attributes, null)
        listOf(attributes, privateKeyAttrs, keySize, tag).forEach { CFRelease(it) }
        if (key == null) {
            logW(TAG, "generateOrLoad: SecKeyCreateRandomKey produced no key")
            return false
        }
        // The key is permanent in the Keychain; this reference is only the +1 from Create.
        CFRelease(key)
        return true
    }

    actual fun getPublicKeyBase64(): String? {
        val alias = currentTag ?: return null
        val privateKey = getPrivateKeyRef(alias) ?: return null
        val publicKey = SecKeyCopyPublicKey(privateKey)
        val data = CFBridgingRelease(SecKeyCopyExternalRepresentation(publicKey, null)) as? NSData
        publicKey?.let { CFRelease(it) }
        CFRelease(privateKey)
        if (data == null) logW(TAG, "getPublicKeyBase64: SecKeyCopyExternalRepresentation produced no data")
        return data?.base64EncodedStringWithOptions(0u)
    }

    actual fun sign(data: ByteArray): ByteArray? {
        val alias = currentTag ?: return null
        val privateKey = getPrivateKeyRef(alias) ?: return null
        val message = data.toCFData()
        val signature =
            CFBridgingRelease(
                SecKeyCreateSignature(privateKey, kSecKeyAlgorithmECDSASignatureMessageX962SHA256, message, null),
            ) as? NSData
        CFRelease(message)
        CFRelease(privateKey)
        if (signature == null) logW(TAG, "sign: SecKeyCreateSignature produced no signature")
        return signature?.toByteArray()
    }

    actual fun delete(alias: String) {
        val tag = alias.toCFData()
        val query =
            cfDictionary {
                CFDictionarySetValue(it, kSecClass, kSecClassKey)
                CFDictionarySetValue(it, kSecAttrApplicationTag, tag)
            }
        val status = SecItemDelete(query)
        CFRelease(query)
        CFRelease(tag)
        if (status != errSecSuccess && status != errSecItemNotFound) {
            logW(TAG, "delete: SecItemDelete failed, OSStatus=$status")
        }
        if (currentTag == alias) currentTag = null
    }

    /** Returns a +1 reference the caller must `CFRelease`, or null when there is no such key. */
    private fun getPrivateKeyRef(alias: String): SecKeyRef? {
        val tag = alias.toCFData()
        val query =
            cfDictionary {
                CFDictionarySetValue(it, kSecClass, kSecClassKey)
                CFDictionarySetValue(it, kSecAttrApplicationTag, tag)
                CFDictionarySetValue(it, kSecAttrKeyClass, kSecAttrKeyClassPrivate)
                CFDictionarySetValue(it, kSecReturnRef, kCFBooleanTrue)
                CFDictionarySetValue(it, kSecMatchLimit, kSecMatchLimitOne)
            }
        memScoped {
            val result = alloc<CFTypeRefVar>()
            val status = SecItemCopyMatching(query, result.ptr)
            CFRelease(query)
            CFRelease(tag)
            if (status != errSecSuccess) {
                if (status != errSecItemNotFound) logW(TAG, "getPrivateKeyRef: SecItemCopyMatching failed, OSStatus=$status")
                return null
            }
            // A SecKeyRef is itself a CF reference: only the pointer's static type narrows here.
            return result.value?.reinterpret()
        }
    }
}

private inline fun cfDictionary(fill: (CFMutableDictionaryRef) -> Unit): CFMutableDictionaryRef {
    val dict = CFDictionaryCreateMutable(null, 0, null, null) ?: error("CFDictionaryCreateMutable returned null")
    fill(dict)
    return dict
}

private fun String.toCFData(): CFDataRef = encodeToByteArray().toCFData()

/** A +1 CFData copy of the bytes; the caller must `CFRelease` it. */
private fun ByteArray.toCFData(): CFDataRef {
    val data =
        if (isEmpty()) {
            CFDataCreate(null, null, 0)
        } else {
            usePinned { pinned -> CFDataCreate(null, pinned.addressOf(0).reinterpret(), size.toLong()) }
        }
    return data ?: error("CFDataCreate returned null")
}
