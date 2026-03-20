@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package com.shyden.shytalk.core.util

import kotlinx.coroutines.suspendCancellableCoroutine
import platform.Foundation.NSError
import platform.LocalAuthentication.LAContext
import platform.LocalAuthentication.LAPolicyDeviceOwnerAuthenticationWithBiometrics
import kotlin.coroutines.resume

actual class BiometricAuth {
    actual fun isAvailable(): Boolean {
        val context = LAContext()
        return context.canEvaluatePolicy(
            LAPolicyDeviceOwnerAuthenticationWithBiometrics,
            error = null,
        )
    }

    actual suspend fun authenticate(
        title: String,
        subtitle: String,
    ): BiometricResult =
        suspendCancellableCoroutine { continuation ->
            val context = LAContext()
            context.localizedFallbackTitle = "Use PIN"

            context.evaluatePolicy(
                LAPolicyDeviceOwnerAuthenticationWithBiometrics,
                localizedReason = subtitle,
            ) { success, error ->
                if (!continuation.isActive) return@evaluatePolicy
                if (success) {
                    continuation.resume(BiometricResult.Success)
                } else {
                    val nsError = error as? NSError
                    val code = nsError?.code ?: -1
                    // LAError.userCancel = -2, LAError.userFallback = -3
                    if (code == -2L || code == -3L) {
                        continuation.resume(BiometricResult.Fallback)
                    } else {
                        continuation.resume(
                            BiometricResult.Error(nsError?.localizedDescription ?: "Biometric failed"),
                        )
                    }
                }
            }
        }
}
