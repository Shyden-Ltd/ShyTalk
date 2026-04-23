@file:Suppress("ktlint:standard:filename")
@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package com.shyden.shytalk.feature.auth

import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import kotlinx.coroutines.suspendCancellableCoroutine
import platform.AuthenticationServices.ASAuthorization
import platform.AuthenticationServices.ASAuthorizationAppleIDCredential
import platform.AuthenticationServices.ASAuthorizationAppleIDProvider
import platform.AuthenticationServices.ASAuthorizationController
import platform.AuthenticationServices.ASAuthorizationControllerDelegateProtocol
import platform.AuthenticationServices.ASAuthorizationControllerPresentationContextProvidingProtocol
import platform.AuthenticationServices.ASAuthorizationScopeEmail
import platform.AuthenticationServices.ASAuthorizationScopeFullName
import platform.AuthenticationServices.ASPresentationAnchor
import platform.Foundation.NSError
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.create
import platform.Security.SecRandomCopyBytes
import platform.Security.errSecSuccess
import platform.Security.kSecRandomDefault
import platform.UIKit.UIApplication
import platform.UIKit.UIWindow
import platform.UIKit.UIWindowScene
import platform.darwin.NSObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private const val TAG = "AppleSignIn"

data class AppleSignInResult(
    val idToken: String,
    val rawNonce: String,
)

/**
 * Triggers Apple Sign-In via ASAuthorizationController.
 * Returns the Apple ID token + raw nonce for Firebase Auth.
 */
suspend fun performAppleSignIn(): AppleSignInResult =
    suspendCancellableCoroutine { continuation ->
        val rawNonce = generateNonce(32)
        val hashedNonce = sha256(rawNonce)

        val provider = ASAuthorizationAppleIDProvider()
        val request = provider.createRequest()
        request.requestedScopes = listOf(ASAuthorizationScopeEmail, ASAuthorizationScopeFullName)
        request.nonce = hashedNonce

        // Must hold strong references to delegate + context provider — ASAuthorizationController
        // uses weak references, so without strong refs they get GC'd before callbacks fire.
        var strongDelegate: NSObject? = null
        var strongContextProvider: NSObject? = null

        val delegate =
            object : NSObject(), ASAuthorizationControllerDelegateProtocol {
                override fun authorizationController(
                    controller: ASAuthorizationController,
                    didCompleteWithAuthorization: ASAuthorization,
                ) {
                    strongDelegate = null
                    strongContextProvider = null
                    val credential = didCompleteWithAuthorization.credential
                    if (credential is ASAuthorizationAppleIDCredential) {
                        val tokenData = credential.identityToken
                        if (tokenData != null) {
                            val idToken =
                                NSString
                                    .create(
                                        data = tokenData,
                                        encoding = NSUTF8StringEncoding,
                                    )?.toString()
                            if (idToken != null) {
                                logI(TAG, "Apple Sign-In succeeded")
                                if (continuation.isActive) {
                                    continuation.resume(AppleSignInResult(idToken, rawNonce))
                                }
                                return
                            }
                        }
                    }
                    if (continuation.isActive) {
                        continuation.resumeWithException(Exception("Apple Sign-In: no identity token"))
                    }
                }

                override fun authorizationController(
                    controller: ASAuthorizationController,
                    didCompleteWithError: NSError,
                ) {
                    strongDelegate = null
                    strongContextProvider = null
                    logE(TAG, "Apple Sign-In failed: ${didCompleteWithError.localizedDescription}")
                    if (continuation.isActive) {
                        continuation.resumeWithException(
                            Exception("Apple Sign-In failed: ${didCompleteWithError.localizedDescription}"),
                        )
                    }
                }
            }

        val contextProvider =
            object : NSObject(), ASAuthorizationControllerPresentationContextProvidingProtocol {
                override fun presentationAnchorForAuthorizationController(controller: ASAuthorizationController): ASPresentationAnchor {
                    // Use connectedScenes (iOS 13+) to find the active window scene
                    val windowScene =
                        UIApplication.sharedApplication.connectedScenes
                            .filterIsInstance<UIWindowScene>()
                            .firstOrNull()
                    val window =
                        windowScene
                            ?.windows
                            ?.filterIsInstance<UIWindow>()
                            ?.firstOrNull { it.isKeyWindow() }
                            ?: windowScene?.windows?.firstOrNull() as? UIWindow
                    return window ?: UIWindow()
                }
            }

        // Hold strong references
        strongDelegate = delegate
        strongContextProvider = contextProvider

        val authController = ASAuthorizationController(authorizationRequests = listOf(request))
        authController.delegate = delegate
        authController.presentationContextProvider = contextProvider
        authController.performRequests()

        continuation.invokeOnCancellation {
            strongDelegate = null
            strongContextProvider = null
        }
    }

private fun generateNonce(length: Int): String {
    val bytes = ByteArray(length)
    bytes.usePinned { pinned ->
        val result = SecRandomCopyBytes(kSecRandomDefault, length.toULong(), pinned.addressOf(0))
        require(result == errSecSuccess) { "Failed to generate random nonce" }
    }
    return bytes.joinToString("") { it.toUByte().toString(16).padStart(2, '0') }
}

private fun sha256(input: String): String {
    val data = input.encodeToByteArray()
    val hash = UByteArray(32)
    data.usePinned { pinnedData ->
        hash.usePinned { pinnedHash ->
            platform.CoreCrypto.CC_SHA256(
                pinnedData.addressOf(0),
                data.size.toUInt(),
                pinnedHash.addressOf(0),
            )
        }
    }
    return hash.joinToString("") { it.toString(16).padStart(2, '0') }
}
