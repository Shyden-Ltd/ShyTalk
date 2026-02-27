package com.shyden.shytalk.core.ui

import android.os.Build
import android.webkit.WebResourceRequest
import android.webkit.WebView
import android.webkit.WebViewClient
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView
import com.shyden.shytalk.core.util.Constants

@Composable
actual fun PlatformWebView(url: String, modifier: Modifier) {
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

                webViewClient = object : WebViewClient() {
                    override fun shouldOverrideUrlLoading(
                        view: WebView?,
                        request: WebResourceRequest?
                    ): Boolean {
                        val requestUrl = request?.url?.toString() ?: return true
                        return !requestUrl.startsWith(Constants.LEGAL_BASE_URL)
                    }
                }
                loadUrl(url)
            }
        },
        modifier = modifier
    )
}
