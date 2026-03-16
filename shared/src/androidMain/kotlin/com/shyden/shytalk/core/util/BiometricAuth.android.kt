package com.shyden.shytalk.core.util

import android.content.Context
import androidx.biometric.BiometricManager
import androidx.biometric.BiometricPrompt
import androidx.fragment.app.FragmentActivity
import kotlinx.coroutines.suspendCancellableCoroutine
import java.lang.ref.WeakReference
import kotlin.coroutines.resume

actual class BiometricAuth(
    private val appContext: Context,
) {
    private var activityRef: WeakReference<FragmentActivity>? = null

    /** Must be called from the Activity before authenticate() works. */
    fun setActivity(activity: FragmentActivity) {
        activityRef = WeakReference(activity)
    }

    actual fun isAvailable(): Boolean {
        val manager = BiometricManager.from(appContext)
        return manager.canAuthenticate(BiometricManager.Authenticators.BIOMETRIC_STRONG) ==
            BiometricManager.BIOMETRIC_SUCCESS
    }

    actual suspend fun authenticate(
        title: String,
        subtitle: String,
    ): BiometricResult =
        suspendCancellableCoroutine { continuation ->
            val activity = activityRef?.get()
            if (activity == null) {
                continuation.resume(BiometricResult.Error("Activity not available"))
                return@suspendCancellableCoroutine
            }

            val promptInfo =
                BiometricPrompt.PromptInfo
                    .Builder()
                    .setTitle(title)
                    .setSubtitle(subtitle)
                    .setNegativeButtonText("Use PIN")
                    .setAllowedAuthenticators(BiometricManager.Authenticators.BIOMETRIC_STRONG)
                    .build()

            val callback =
                object : BiometricPrompt.AuthenticationCallback() {
                    override fun onAuthenticationSucceeded(result: BiometricPrompt.AuthenticationResult) {
                        if (continuation.isActive) continuation.resume(BiometricResult.Success)
                    }

                    override fun onAuthenticationError(
                        errorCode: Int,
                        errString: CharSequence,
                    ) {
                        if (!continuation.isActive) return
                        if (errorCode == BiometricPrompt.ERROR_NEGATIVE_BUTTON ||
                            errorCode == BiometricPrompt.ERROR_USER_CANCELED
                        ) {
                            continuation.resume(BiometricResult.Fallback)
                        } else {
                            continuation.resume(BiometricResult.Error(errString.toString()))
                        }
                    }

                    override fun onAuthenticationFailed() {
                        // Individual attempt failed but prompt stays open
                    }
                }

            val executor = activity.mainExecutor
            val prompt = BiometricPrompt(activity, executor, callback)
            prompt.authenticate(promptInfo)

            continuation.invokeOnCancellation {
                prompt.cancelAuthentication()
            }
        }
}
