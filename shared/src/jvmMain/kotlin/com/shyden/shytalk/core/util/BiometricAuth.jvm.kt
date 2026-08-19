package com.shyden.shytalk.core.util

/**
 * JVM stub for BiometricAuth — exists solely to host commonTest/jvmTest runs
 * (Android/iOS ship the real actuals). The `*ForTest` seams let jvmTest drive
 * the REAL authenticateWithBiometric flow in LockScreenViewModel
 * (challenge → sign → verify → session-restore), which was untestable while
 * this stub hardcoded an error (SHY-0187 R2 coverage gap).
 */
actual class BiometricAuth {
    var availableForTest: Boolean = false
    var authenticateResultForTest: BiometricResult = BiometricResult.Error("Biometric not available on JVM")

    actual fun isAvailable(): Boolean = availableForTest

    actual suspend fun authenticate(
        title: String,
        subtitle: String,
    ): BiometricResult = authenticateResultForTest
}
