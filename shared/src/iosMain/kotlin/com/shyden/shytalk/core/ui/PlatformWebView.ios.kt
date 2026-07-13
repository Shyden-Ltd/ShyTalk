@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package com.shyden.shytalk.core.ui

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.UIKitInteropInteractionMode
import androidx.compose.ui.viewinterop.UIKitInteropProperties
import androidx.compose.ui.viewinterop.UIKitView
import com.shyden.shytalk.core.util.WebUrls
import platform.Foundation.NSError
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
import platform.WebKit.WKNavigation
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
    val isError = remember { mutableStateOf(false) }
    val webViewHolder = remember { WkWebViewHolder() }
    // Per-instance delegate (remembered → strongly held for the composable's
    // lifetime, so WKWebView's `weak navigationDelegate` never dangles). It
    // carries the load state back to Compose so a failed load shows a diagnostic
    // instead of a blank page (SHY-0182 Error-path AC).
    val delegate =
        remember {
            LegalWebViewDelegate(
                onLoadStarted = { isError.value = false },
                onLoadError = { isError.value = true },
            )
        }

    Box(modifier = modifier) {
        UIKitView(
            factory = {
                WKWebView().apply {
                    webViewHolder.webView = this
                    // The delegate keeps in-page navigation on the loaded legal
                    // page's origin, answers the dev web pages' Basic-auth
                    // challenge, and reports load failures (SHY-0182), mirroring
                    // the Android WebViewClient.
                    navigationDelegate = delegate
                    val nsUrl = NSURL.URLWithString(url) ?: return@apply
                    loadRequest(NSURLRequest.requestWithURL(nsUrl))
                }
            },
            modifier = Modifier.fillMaxSize(),
            properties =
                UIKitInteropProperties(
                    interactionMode = UIKitInteropInteractionMode.NonCooperative,
                    isNativeAccessibilityEnabled = true,
                ),
        )

        if (isError.value) {
            WebViewLoadError(
                onRetry = {
                    isError.value = false
                    webViewHolder.webView?.reload()
                },
                modifier = Modifier.fillMaxSize(),
            )
        }
    }
}

/** Holds the [WKWebView] so the retry affordance can reload it. */
private class WkWebViewHolder {
    var webView: WKWebView? = null
}

/**
 * WKWebView delegate mirroring the Android `WebViewClient` (SHY-0182). Its
 * navigation + auth decisions are the pure, unit-tested [WebUrls] helpers — this
 * class is only the platform translation into WKWebView's callbacks, so the
 * interesting logic stays testable off-device:
 *
 *  - navigation is gated by [WebUrls.shouldAllowWebViewNavigation] (stay on the
 *    origin the legal page loaded from; the initial `nil`-URL load is allowed);
 *  - Basic-auth challenges are answered by [WebUrls.webViewAuthChallengeAction]
 *    (dev build + our dev host + secret present → credential, else cancel), while
 *    any NON-Basic challenge (e.g. TLS server-trust) falls through to the
 *    platform's default handling so certificate validation is never subverted;
 *  - a REAL load failure (network down, a cancelled dev-page Basic-auth
 *    challenge) fires [onLoadError] so a diagnostic replaces the blank page,
 *    while a deliberate cancellation (our nav-gate blocking an off-origin link,
 *    or a navigate-away) is filtered out by [WebUrls.shouldShowWebViewLoadError].
 *
 * Per-instance (not a singleton) because it must report load state back to ITS
 * WebView's Compose state via [onLoadStarted]/[onLoadError]; the composable
 * `remember`s it so it outlives the factory and isn't collected.
 */
@Suppress("PARAMETER_NAME_CHANGED_ON_OVERRIDE")
private class LegalWebViewDelegate(
    private val onLoadStarted: () -> Unit,
    private val onLoadError: () -> Unit,
) : NSObject(),
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

    override fun webView(
        webView: WKWebView,
        didStartProvisionalNavigation: WKNavigation?,
    ) {
        onLoadStarted() // a fresh load clears any prior diagnostic
    }

    // Only the PROVISIONAL failure is handled: a pre-commit failure (the legal
    // page never loaded — network down, or the Basic-auth challenge we cancelled)
    // is what leaves a truly BLANK page, which is the AC's concern. A post-commit
    // `didFailNavigation` leaves partially-rendered content, not a blank page —
    // and it can't be overridden alongside this one anyway (identical Kotlin
    // signature, differing only by Obj-C selector → conflicting overloads).
    override fun webView(
        webView: WKWebView,
        didFailProvisionalNavigation: WKNavigation?,
        withError: NSError,
    ) {
        if (WebUrls.shouldShowWebViewLoadError(withError.domain, withError.code)) onLoadError()
    }
}
