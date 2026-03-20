@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package com.shyden.shytalk.core.util

import kotlinx.cinterop.alloc
import kotlinx.cinterop.memScoped
import kotlinx.cinterop.ptr
import kotlinx.cinterop.value
import platform.CoreFoundation.CFDictionaryRef
import platform.Foundation.NSData
import platform.Foundation.base64EncodedStringWithOptions
import platform.Foundation.create
import platform.Security.SecItemCopyMatching
import platform.Security.SecItemDelete
import platform.Security.SecKeyCopyExternalRepresentation
import platform.Security.SecKeyCreateRandomKey
import platform.Security.SecKeyCreateSignature
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

@Suppress("UNCHECKED_CAST")
actual class CryptoKeyPair {
    private var currentTag: String? = null

    actual fun generateOrLoad(alias: String): Boolean {
        currentTag = alias
        // Try to load existing key first
        if (getPrivateKeyRef(alias) != null) return true

        // Generate new keypair
        val tagData = alias.encodeToByteArray().toNSData() ?: return false
        val attributes =
            mapOf<Any?, Any?>(
                kSecAttrKeyType to kSecAttrKeyTypeECSECPrimeRandom,
                kSecAttrKeySizeInBits to 256,
                kSecPrivateKeyAttrs to
                    mapOf<Any?, Any?>(
                        kSecAttrIsPermanent to true,
                        kSecAttrApplicationTag to tagData,
                    ),
            )

        val key = SecKeyCreateRandomKey(attributes as CFDictionaryRef, null)
        return key != null
    }

    actual fun getPublicKeyBase64(): String? {
        val alias = currentTag ?: return null
        val privateKey = getPrivateKeyRef(alias) ?: return null

        val publicKey = platform.Security.SecKeyCopyPublicKey(privateKey) ?: return null
        val data = SecKeyCopyExternalRepresentation(publicKey, null) as? NSData ?: return null
        return data.base64EncodedStringWithOptions(0u)
    }

    actual fun sign(data: ByteArray): ByteArray? {
        val alias = currentTag ?: return null
        val privateKey = getPrivateKeyRef(alias) ?: return null
        val nsData = data.toNSData()

        val signature =
            SecKeyCreateSignature(
                privateKey,
                kSecKeyAlgorithmECDSASignatureMessageX962SHA256,
                nsData as platform.CoreFoundation.CFDataRef,
                null,
            ) as? NSData ?: return null
        return signature.toByteArray()
    }

    actual fun delete(alias: String) {
        val tagData = alias.encodeToByteArray().toNSData() ?: return
        val query =
            mapOf<Any?, Any?>(
                kSecClass to kSecClassKey,
                kSecAttrApplicationTag to tagData,
            )
        SecItemDelete(query as CFDictionaryRef)
        if (currentTag == alias) currentTag = null
    }

    private fun getPrivateKeyRef(alias: String): platform.Security.SecKeyRef? {
        val tagData = alias.encodeToByteArray().toNSData() ?: return null
        val query =
            mapOf<Any?, Any?>(
                kSecClass to kSecClassKey,
                kSecAttrApplicationTag to tagData,
                kSecAttrKeyClass to kSecAttrKeyClassPrivate,
                kSecReturnRef to true,
                kSecMatchLimit to kSecMatchLimitOne,
            )
        memScoped {
            val result = alloc<platform.CoreFoundation.CFTypeRefVar>()
            val status = SecItemCopyMatching(query as CFDictionaryRef, result.ptr)
            if (status != errSecSuccess) return null
            @Suppress("UNCHECKED_CAST")
            return result.value as? platform.Security.SecKeyRef
        }
    }
}

// Extension helpers
private fun ByteArray.toNSData(): NSData =
    memScoped {
        NSData.create(bytes = kotlinx.cinterop.allocArrayOf(this@toNSData), length = this@toNSData.size.toULong())
    }

@OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
private fun NSData.toByteArray(): ByteArray {
    val size = this.length.toInt()
    val bytes = ByteArray(size)
    if (size > 0) {
        kotlinx.cinterop.memScoped {
            val ptr = this@toByteArray.bytes
            if (ptr != null) {
                for (i in 0 until size) {
                    bytes[i] = (ptr as kotlinx.cinterop.CPointer<kotlinx.cinterop.ByteVar>)[i]
                }
            }
        }
    }
    return bytes
}
