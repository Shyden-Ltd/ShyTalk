package com.shyden.shytalk.data.repository

interface OtpRepository {
    /** Send OTP code to email. Returns success or error. */
    suspend fun sendOtp(email: String): Result<Unit>

    /** Verify OTP code. Returns Firebase custom token on success. */
    suspend fun verifyOtp(
        email: String,
        code: String,
    ): Result<String>
}
