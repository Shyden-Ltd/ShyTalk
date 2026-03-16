package com.shyden.shytalk.data.repository

data class PinVerifyResult(
    val customToken: String? = null,
    val locked: Boolean = false,
    val lockedUntil: Long? = null,
    val requiresReauth: Boolean = false,
    val attemptsRemaining: Int = 5,
)

interface PinRepository {
    /** Create or replace PIN for the authenticated user. Returns the bcrypt hash for local storage. */
    suspend fun setupPin(pin: String): Result<String>

    /** Verify PIN. Returns PinVerifyResult with custom token or lockout info. */
    suspend fun verifyPin(
        uniqueId: String,
        deviceId: String,
        pin: String,
    ): Result<PinVerifyResult>

    /** Reset PIN after re-authentication. Clears lockout state. */
    suspend fun resetPin(newPin: String): Result<Unit>
}
