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
                                    val requestUrl = request?.url?.toString() ?: return true
                                    // Keep in-page navigation on the host the page was loaded
                                    // from — for ANY environment (SHY-0182). The old hardcoded
                                    // Constants.LEGAL_BASE_URL (prod) blocked every link on a
                                    // dev/local build's own pages.
                                    return !requestUrl.startsWith(WebUrls.originOf(url))
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
