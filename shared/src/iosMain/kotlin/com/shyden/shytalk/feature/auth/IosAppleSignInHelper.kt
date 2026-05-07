@file:Suppress("ktlint:standard:filename")
@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package com.shyden.shytalk.feature.auth

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
import platform.UIKit.UISceneActivationStateForegroundActive
import platform.UIKit.UIWindow
import platform.UIKit.UIWindowScene
import platform.darwin.NSObject
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

private const val TAG = "AppleSignIn"

// ASAuthorizationErrorCanceled — value from
// platform.AuthenticationServices.ASAuthorizationError. Hard-coded here
// because Kotlin/Native doesn't expose the enum case as a constant.
// 1001 has been stable since iOS 13.
private const val APPLE_SIGNIN_ERROR_CANCELED: Long = 1001

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
        // Pre-flight: ASAuthorizationController on iOS 15+ requires a
        // scene-attached UIWindow as presentation anchor. Returning a
        // bare UIWindow() (no scene) is an Apple contract violation and
        // results in silent presentation failure on iPad multi-scene
        // state. Fail loudly here so the caller's existing snackbar path
        // surfaces it, instead of waiting for a no-op auth controller.
        val anchorWindow = activePresentationWindow()
        if (anchorWindow == null) {
            continuation.resumeWithException(
                Exception("Apple Sign-In: no active UIWindow to anchor presentation"),
            )
            return@suspendCancellableCoroutine
        }

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
                    // Detect user cancellation by NSError code at the
                    // typed-error boundary (1001 = ASAuthorizationErrorCanceled)
                    // rather than substring-matching localizedDescription
                    // downstream — Apple localises that string per device
                    // locale ("abgebrochen", "annulé", "キャンセル"), so
                    // string sniffing would only catch English cancels.
                    val isCancellation =
                        didCompleteWithError.domain == "com.apple.AuthenticationServices.AuthorizationError" &&
                            didCompleteWithError.code == APPLE_SIGNIN_ERROR_CANCELED
                    if (continuation.isActive) {
                        if (isCancellation) {
                            // No log on cancel — the caller treats this as
                            // a silent user gesture, not a failure.
                            continuation.resumeWithException(AppleSignInCancelledException())
                        } else {
                            // Caller (IosSignInScreen.kt) logs the wrapped
                            // exception via logW once it propagates — duplicating
                            // here would just produce two Sentry events for the
                            // same failure. The localizedDescription is included
                            // in the Exception message for that single log.
                            continuation.resumeWithException(
                                Exception("Apple Sign-In failed: ${didCompleteWithError.localizedDescription}"),
                            )
                        }
                    }
                }
            }

        val contextProvider =
            object : NSObject(), ASAuthorizationControllerPresentationContextProvidingProtocol {
                override fun presentationAnchorForAuthorizationController(controller: ASAuthorizationController): ASPresentationAnchor =
                    anchorWindow
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

/**
 * Returns the active scene-attached UIWindow suitable as an
 * `ASPresentationAnchor`, or null if the app is not in a foreground-
 * active scene state. Apple requires the anchor to belong to a
 * UIWindowScene whose `activationState == foregroundActive`; a window
 * from a backgrounded or inactive scene is the same category of
 * contract violation as a bare unattached `UIWindow()`. iPad multi-
 * scene apps can have several connected scenes simultaneously where
 * only one is foreground-active, so filter explicitly.
 */
private fun activePresentationWindow(): UIWindow? {
    val windowScene =
        UIApplication.sharedApplication.connectedScenes
            .filterIsInstance<UIWindowScene>()
            .firstOrNull { it.activationState == UISceneActivationStateForegroundActive }
            ?: return null
    return windowScene.windows
        .filterIsInstance<UIWindow>()
        .firstOrNull { it.isKeyWindow() }
        ?: windowScene.windows.firstOrNull() as? UIWindow
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
