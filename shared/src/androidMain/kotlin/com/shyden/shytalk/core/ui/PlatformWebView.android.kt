package com.shyden.shytalk.core.ui

import android.graphics.Bitmap
import android.graphics.Color
import android.os.Build
import android.webkit.WebResourceRequest
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

    Surface(color = MaterialTheme.colorScheme.background, modifier = modifier) {
        Box(modifier = Modifier.fillMaxSize()) {
            AndroidView(
                factory = { context ->
                    WebView(context).apply {
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
                                }

                                override fun onPageFinished(
                                    view: WebView?,
                                    url: String?,
                                ) {
                                    isLoading = false
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
                            }
                        loadUrl(url)
                    }
                },
                modifier = Modifier.fillMaxSize(),
            )

            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.align(Alignment.Center),
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}
