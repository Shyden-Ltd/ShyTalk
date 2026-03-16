package com.shyden.shytalk.core.util

/** JVM stub for CryptoKeyPair — used only for running commonTest. */
actual class CryptoKeyPair {
    actual fun generateOrLoad(alias: String): Boolean = false

    actual fun getPublicKeyBase64(): String? = null

    actual fun sign(data: ByteArray): ByteArray? = null

    actual fun delete(alias: String) {}
}
