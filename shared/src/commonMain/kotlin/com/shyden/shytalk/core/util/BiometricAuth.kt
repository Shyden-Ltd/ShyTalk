package com.shyden.shytalk.core.util

sealed class BiometricResult {
    data object Success : BiometricResult()

    data object Fallback : BiometricResult()

    data class Error(
        val message: String,
    ) : BiometricResult()
}

/**
 * Platform-specific biometric authentication.
 * Android: BiometricPrompt (fingerprint/face).
 * iOS: LAContext (Face ID/Touch ID).
 */
expect class BiometricAuth {
    fun isAvailable(): Boolean

    suspend fun authenticate(
        title: String,
        subtitle: String,
    ): BiometricResult
}
