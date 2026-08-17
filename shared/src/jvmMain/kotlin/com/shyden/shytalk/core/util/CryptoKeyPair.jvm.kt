package com.shyden.shytalk.core.util

/**
 * JVM stub for CryptoKeyPair — exists solely to host commonTest/jvmTest runs
 * (Android/iOS ship the real keystore-backed actuals). `signResultForTest`
 * lets jvmTest drive LockScreenViewModel's REAL biometric verify path; the
 * default `null` is the platform-keystore failure mode (SHY-0187 R2).
 */
actual class CryptoKeyPair {
    var signResultForTest: ByteArray? = null

    actual fun generateOrLoad(alias: String): Boolean = false

    actual fun getPublicKeyBase64(): String? = null

    actual fun sign(data: ByteArray): ByteArray? = signResultForTest

    actual fun delete(alias: String) {}
}
