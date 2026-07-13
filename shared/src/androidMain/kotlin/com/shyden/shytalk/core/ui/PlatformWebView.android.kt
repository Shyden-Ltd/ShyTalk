package com.shyden.shytalk.core.ui

import android.graphics.Bitmap
import android.graphics.Color
import android.os.Build
import android.webkit.WebResourceError
import android.webkit.WebResourceRequest
import android.webkit.WebResourceResponse
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.shyden.shytalk.core.util.WebUrls

@Composable
actual fun PlatformWebView(
    url: String,
    modifier: Modifier,
) {
    var isLoading by remember { mutableStateOf(true) }
    var isError by remember { mutableStateOf(false) }
    // Plain holder (not Compose state) — the retry callback needs the WebView to
    // reload(); we never recompose on it being set, so it must not be state.
    val webViewRef = remember { WebViewHolder() }

    Surface(color = MaterialTheme.colorScheme.background, modifier = modifier) {
        Box(modifier = Modifier.fillMaxSize()) {
            AndroidView(
                factory = { context ->
                    WebView(context).apply {
                        webViewRef.webView = this
                        settings.javaScriptEnabled = true
                        settings.allowFileAccess = false

                        @Suppress("DEPRECATION")
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                            settings.isAlgorithmicDarkeningAllowed = true
                        } else if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.Q) {
                            settings.forceDark = android.webkit.WebSettings.FORCE_DARK_AUTO
                        }

                        setBackgroundColor(Color.TRANSPARENT)

                        webViewClient =
                            object : WebViewClient() {
                                override fun onPageStarted(
                                    view: WebView?,
                                    url: String?,
                                    favicon: Bitmap?,
                                ) {
                                    isLoading = true
                                    isError = false // a fresh load clears any prior diagnostic
                                }

                                override fun onPageFinished(
                                    view: WebView?,
                                    url: String?,
                                ) {
                                    isLoading = false
                                }

                                // A MAIN-FRAME load failure (network down, or the
                                // dev-page Basic-auth challenge we cancelled → the
                                // request fails) must surface a diagnostic, NOT a
                                // blank WebView (SHY-0182 Error-path AC). Sub-resource
                                // failures (a missing image) are ignored — they must
                                // not blank a page that otherwise loaded.
                                override fun onReceivedError(
                                    view: WebView?,
                                    request: WebResourceRequest?,
                                    error: WebResourceError?,
                                ) {
                                    if (request?.isForMainFrame == true) {
                                        isError = true
                                        isLoading = false
                                    }
                                }

                                override fun onReceivedHttpError(
                                    view: WebView?,
                                    request: WebResourceRequest?,
                                    errorResponse: WebResourceResponse?,
                                ) {
                                    // A cancelled Basic-auth challenge comes back as a
                                    // main-frame 401 here — show the diagnostic.
                                    if (request?.isForMainFrame == true) {
                                        isError = true
                                        isLoading = false
                                    }
                                }

                                override fun shouldOverrideUrlLoading(
                                    view: WebView?,
                                    request: WebResourceRequest?,
                                ): Boolean {
                                    // `request.url` is already parsed by the platform; its
                                    // canonical string form feeds an EXACT same-origin check
                                    // (scheme+host+port, userinfo rejected) — NOT a prefix
                                    // match, which `https://host@evil.com` would bypass
                                    // (SHY-0182 security fix). Keeps in-page navigation on the
                                    // host the page loaded from, for ANY environment.
                                    val requestUrl = request?.url?.toString() ?: return true
                                    return !WebUrls.isSameOrigin(url, requestUrl)
                                }

                                // Answer the dev web pages' Basic-auth challenge
                                // (realm "ShyTalk Non-Prod") so a dev build can open
                                // its own restricted pages (SHY-0182). WebUrls gates
                                // the secret to dev builds + the dev host only; any
                                // other challenger (prod, an off-site redirect) gets
                                // cancel() — the secret never leaks.
                                override fun onReceivedHttpAuthRequest(
                                    view: WebView?,
                                    handler: android.webkit.HttpAuthHandler?,
                                    host: String?,
                                    realm: String?,
                                ) {
                                    if (handler == null) return
                                    val credential = WebUrls.devWebBasicAuthForCurrentBuild(host)
                                    if (credential != null) {
                                        handler.proceed(credential.first, credential.second)
                                    } else {
                                        handler.cancel()
                                    }
                                }
                            }
                        loadUrl(url)
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )

            if (isLoading && !isError) {
                CircularProgressIndicator(
                    modifier = Modifier.align(Alignment.Center),
                    color = MaterialTheme.colorScheme.primary,
                )
            }

            if (isError) {
                WebViewLoadError(
                    onRetry = {
                        isError = false
                        isLoading = true
                        webViewRef.webView?.reload()
                    },
                    modifier = Modifier.fillMaxSize(),
                )
            }
        }
    }
}

/** Holds the [WebView] so the retry affordance can [WebView.reload] it. */
private class WebViewHolder {
    var webView: WebView? = null
}
