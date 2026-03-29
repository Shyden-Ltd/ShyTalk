package com.shyden.shytalk.feature.auth

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.LiveRegionMode
import androidx.compose.ui.semantics.liveRegion
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.shyden.shytalk.core.util.SecureScreenEffect
import com.shyden.shytalk.feature.auth.components.PinDots
import com.shyden.shytalk.feature.auth.components.PinKeypad
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

@Suppress("kotlin:S3776")
@Composable
fun LockScreen(
    onUnlocked: () -> Unit,
    onReauthRequired: () -> Unit,
    viewModel: LockScreenViewModel = koinViewModel(),
    modifier: Modifier = Modifier,
) {
    SecureScreenEffect()

    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(state.biometricAvailable) {
        if (state.biometricAvailable) {
            viewModel.authenticateWithBiometric()
        }
    }

    LaunchedEffect(state.unlocked) {
        if (state.unlocked) onUnlocked()
    }

    LaunchedEffect(state.requiresReauth) {
        if (state.requiresReauth) onReauthRequired()
    }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .background(MaterialTheme.colorScheme.background)
                .padding(24.dp)
                .testTag("lockScreen"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = if (state.isLocked) stringResource(Res.string.account_locked) else stringResource(Res.string.enter_pin),
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onBackground,
        )

        Spacer(Modifier.height(8.dp))

        if (state.error != null) {
            Text(
                text = state.error!!.resolve(),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        } else if (state.isLocked) {
            Text(
                text = stringResource(Res.string.pin_locked_reauth),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }

        Spacer(Modifier.height(32.dp))

        PinDots(
            length = state.pinInput.length,
            maxLength = 8,
            modifier = Modifier.testTag("pinDots"),
        )

        Spacer(Modifier.height(32.dp))

        if (state.isLoading) {
            CircularProgressIndicator(modifier = Modifier.size(48.dp))
        } else if (!state.isLocked) {
            PinKeypad(
                onDigit = { viewModel.onPinDigit(it) },
                onBackspace = { viewModel.onPinBackspace() },
                onBiometric =
                    if (state.biometricAvailable) {
                        { viewModel.authenticateWithBiometric() }
                    } else {
                        null
                    },
                modifier = Modifier.testTag("pinKeypad"),
            )

            Spacer(Modifier.height(16.dp))

            TextButton(
                onClick = { viewModel.submitPin() },
                enabled = state.pinInput.length >= 4,
            ) {
                Text(stringResource(Res.string.unlock))
            }
        }
    }
}
