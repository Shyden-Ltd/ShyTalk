package com.shyden.shytalk.core.util

import android.security.keystore.KeyGenParameterSpec
import android.security.keystore.KeyPermanentlyInvalidatedException
import android.security.keystore.KeyProperties
import android.util.Base64
import android.util.Log
import java.security.KeyPairGenerator
import java.security.KeyStore
import java.security.Signature

actual class CryptoKeyPair {
    private var currentAlias: String? = null
    private val keyStore = KeyStore.getInstance("AndroidKeyStore").apply { load(null) }

    actual fun generateOrLoad(alias: String): Boolean {
        currentAlias = alias
        return try {
            if (keyStore.containsAlias(alias)) {
                true
            } else {
                val spec =
                    KeyGenParameterSpec
                        .Builder(
                            alias,
                            KeyProperties.PURPOSE_SIGN or KeyProperties.PURPOSE_VERIFY,
                        ).setDigests(KeyProperties.DIGEST_SHA256)
                        .setAlgorithmParameterSpec(java.security.spec.ECGenParameterSpec("secp256r1"))
                        .build()
                val generator =
                    KeyPairGenerator.getInstance(
                        KeyProperties.KEY_ALGORITHM_EC,
                        "AndroidKeyStore",
                    )
                generator.initialize(spec)
                generator.generateKeyPair()
                true
            }
        } catch (e: Exception) {
            Log.e("CryptoKeyPair", "generateOrLoad failed for alias=$alias: ${e.javaClass.simpleName}: ${e.message}")
            false
        }
    }

    actual fun getPublicKeyBase64(): String? {
        val alias = currentAlias ?: return null
        return try {
            val entry = keyStore.getCertificate(alias) ?: return null
            Base64.encodeToString(entry.publicKey.encoded, Base64.NO_WRAP)
        } catch (e: Exception) {
            Log.e("CryptoKeyPair", "getPublicKeyBase64 failed: ${e.javaClass.simpleName}: ${e.message}")
            null
        }
    }

    actual fun sign(data: ByteArray): ByteArray? {
        val alias = currentAlias ?: return null
        return try {
            val privateKey = keyStore.getKey(alias, null) as? java.security.PrivateKey ?: return null
            val signature = Signature.getInstance("SHA256withECDSA")
            signature.initSign(privateKey)
            signature.update(data)
            signature.sign()
        } catch (e: KeyPermanentlyInvalidatedException) {
            Log.e("CryptoKeyPair", "Key invalidated (biometric enrollment changed) for alias=$alias. Deleting key.")
            delete(alias)
            null
        } catch (e: Exception) {
            Log.e("CryptoKeyPair", "sign failed: ${e.javaClass.simpleName}: ${e.message}")
            null
        }
    }

    actual fun delete(alias: String) {
        try {
            keyStore.deleteEntry(alias)
            if (currentAlias == alias) currentAlias = null
        } catch (e: Exception) {
            Log.w("CryptoKeyPair", "delete failed for alias=$alias: ${e.message}")
        }
    }
}
