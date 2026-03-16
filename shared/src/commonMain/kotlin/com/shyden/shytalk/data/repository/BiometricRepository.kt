package com.shyden.shytalk.data.repository

interface BiometricRepository {
    /** Register a biometric public key for the current device. */
    suspend fun register(
        publicKeyBase64: String,
        deviceId: String,
    ): Result<Unit>

    /** Get a challenge nonce for biometric verification. */
    suspend fun getChallenge(
        uniqueId: String,
        deviceId: String,
    ): Result<String>

    /** Verify a signed challenge. Returns Firebase custom token on success. */
    suspend fun verify(
        uniqueId: String,
        deviceId: String,
        signatureBase64: String,
    ): Result<String>

    /** Revoke biometric key for a device (e.g. on sign-out). */
    suspend fun revoke(deviceId: String): Result<Unit>
}
