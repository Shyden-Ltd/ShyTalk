package com.shyden.shytalk.core.util

/** JVM stub for BiometricAuth — used only for running commonTest. */
actual class BiometricAuth {
    actual fun isAvailable(): Boolean = false

    actual suspend fun authenticate(
        title: String,
        subtitle: String,
    ): BiometricResult = BiometricResult.Error("Biometric not available on JVM")
}
