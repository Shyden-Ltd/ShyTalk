package com.shyden.shytalk.core.ui

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.connection_trouble
import com.shyden.shytalk.resources.retry
import org.jetbrains.compose.resources.stringResource

@Composable
expect fun PlatformWebView(
    url: String,
    modifier: Modifier = Modifier,
)

/**
 * The visible diagnostic a [PlatformWebView] shows INSTEAD of a blank page when
 * its main-frame load fails — including a cancelled dev-page Basic-auth
 * challenge (SHY-0182 Error-path AC: "a dev-page access-credential failure
 * surfaces a clear diagnostic, not a blank WebView"). This is why it's a
 * consent gate that must never leave the user staring at nothing.
 *
 * Shared across Android + iOS so both platforms render the identical
 * message + [onRetry] affordance. Reuses the existing all-20-locale
 * `connection_trouble` + `retry` strings (no new user-facing string). Opaque
 * [Surface] so it fully covers the failed WebView rather than letting a blank
 * page show through.
 */
@Composable
internal fun WebViewLoadError(
    onRetry: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Surface(
        color = MaterialTheme.colorScheme.background,
        modifier = modifier.testTag("webView_loadError"),
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            Text(
                text = stringResource(Res.string.connection_trouble),
                style = MaterialTheme.typography.bodyLarge,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
            )
            Button(
                onClick = onRetry,
                modifier =
                    Modifier
                        .padding(top = 16.dp)
                        .testTag("webView_retryButton"),
            ) {
                Text(stringResource(Res.string.retry))
            }
        }
    }
}
