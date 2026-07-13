@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package com.shyden.shytalk.core.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.UIKitInteropInteractionMode
import androidx.compose.ui.viewinterop.UIKitInteropProperties
import androidx.compose.ui.viewinterop.UIKitView
import com.shyden.shytalk.core.util.WebUrls
import platform.Foundation.NSURL
import platform.Foundation.NSURLAuthenticationChallenge
import platform.Foundation.NSURLAuthenticationMethodHTTPBasic
import platform.Foundation.NSURLCredential
import platform.Foundation.NSURLCredentialPersistence
import platform.Foundation.NSURLRequest
import platform.Foundation.NSURLSessionAuthChallengeCancelAuthenticationChallenge
import platform.Foundation.NSURLSessionAuthChallengeDisposition
import platform.Foundation.NSURLSessionAuthChallengePerformDefaultHandling
import platform.Foundation.NSURLSessionAuthChallengeUseCredential
import platform.Foundation.create
import platform.WebKit.WKNavigationAction
import platform.WebKit.WKNavigationActionPolicy
import platform.WebKit.WKNavigationDelegateProtocol
import platform.WebKit.WKWebView
import platform.darwin.NSObject

@Composable
actual fun PlatformWebView(
    url: String,
    modifier: Modifier,
) {
    UIKitView(
        factory = {
            WKWebView().apply {
                // The delegate keeps in-page navigation on the loaded legal
                // page's origin AND answers the dev web pages' Basic-auth
                // challenge (SHY-0182), mirroring the Android WebViewClient.
                navigationDelegate = LegalWebViewDelegate
                val nsUrl = NSURL.URLWithString(url) ?: return@apply
                loadRequest(NSURLRequest.requestWithURL(nsUrl))
            }
        },
        modifier = modifier,
        properties =
            UIKitInteropProperties(
                interactionMode = UIKitInteropInteractionMode.NonCooperative,
                isNativeAccessibilityEnabled = true,
            ),
    )
}

/**
 * WKWebView delegate mirroring the Android `WebViewClient` (SHY-0182). Both of
 * its decisions are the pure, unit-tested [WebUrls] helpers — this object is
 * only the platform translation into WKWebView's `completionHandler`/policy
 * callbacks, so the interesting logic stays testable off-device:
 *
 *  - navigation is gated by [WebUrls.shouldAllowWebViewNavigation] (stay on the
 *    origin the legal page loaded from; the initial `nil`-URL load is allowed);
 *  - Basic-auth challenges are answered by [WebUrls.webViewAuthChallengeAction]
 *    (dev build + our dev host + secret present → credential, else cancel), while
 *    any NON-Basic challenge (e.g. TLS server-trust) falls through to the
 *    platform's default handling so certificate validation is never subverted.
 *
 * A stateless Kotlin `object`: every decision comes from the callback arguments,
 * never instance state, so one shared delegate is correct for every WebView —
 * and, being a singleton GC root, it can never be collected while WKWebView
 * holds it in its `weak navigationDelegate` (no per-instance retention dance).
 */
@Suppress("PARAMETER_NAME_CHANGED_ON_OVERRIDE")
private object LegalWebViewDelegate :
    NSObject(),
    WKNavigationDelegateProtocol {
    override fun webView(
        webView: WKWebView,
        decidePolicyForNavigationAction: WKNavigationAction,
        decisionHandler: (WKNavigationActionPolicy) -> Unit,
    ) {
        val allow =
            WebUrls.shouldAllowWebViewNavigation(
                currentUrl = webView.URL?.absoluteString,
                targetUrl = decidePolicyForNavigationAction.request.URL?.absoluteString,
            )
        decisionHandler(
            if (allow) {
                WKNavigationActionPolicy.WKNavigationActionPolicyAllow
            } else {
                WKNavigationActionPolicy.WKNavigationActionPolicyCancel
            },
        )
    }

    override fun webView(
        webView: WKWebView,
        didReceiveAuthenticationChallenge: NSURLAuthenticationChallenge,
        completionHandler: (NSURLSessionAuthChallengeDisposition, NSURLCredential?) -> Unit,
    ) {
        val space = didReceiveAuthenticationChallenge.protectionSpace
        when (
            val action =
                WebUrls.webViewAuthChallengeAction(
                    isBasicAuthChallenge = space.authenticationMethod == NSURLAuthenticationMethodHTTPBasic,
                    challengingHost = space.host,
                )
        ) {
            is WebUrls.WebViewAuthChallengeAction.UseCredential ->
                completionHandler(
                    NSURLSessionAuthChallengeUseCredential,
                    // K/N's sanctioned factory for the non-designated
                    // initWithUser:password:persistence: initializer (the raw
                    // init binding is @Deprecated(ERROR) → ReplaceWith .create).
                    NSURLCredential.create(
                        user = action.username,
                        password = action.password,
                        persistence = NSURLCredentialPersistence.NSURLCredentialPersistenceForSession,
                    ),
                )

            WebUrls.WebViewAuthChallengeAction.Cancel ->
                completionHandler(NSURLSessionAuthChallengeCancelAuthenticationChallenge, null)

            WebUrls.WebViewAuthChallengeAction.PerformDefault ->
                completionHandler(NSURLSessionAuthChallengePerformDefaultHandling, null)
        }
    }
}
