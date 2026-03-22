package com.shyden.shytalk.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.FilterChip
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

@Composable
fun PinSetupScreen(
    onCompleted: () -> Unit,
    biometricAvailable: Boolean = false,
    viewModel: PinSetupViewModel = koinViewModel(),
    modifier: Modifier = Modifier,
) {
    SecureScreenEffect()

    val state by viewModel.state.collectAsStateWithLifecycle()

    LaunchedEffect(state.completed) {
        if (state.completed) onCompleted()
    }

    Column(
        modifier =
            modifier
                .fillMaxSize()
                .padding(24.dp)
                .testTag("pinSetupScreen"),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        when (state.step) {
            PinSetupStep.ChooseLength ->
                PinLengthChooser(
                    selected = state.pinLength,
                    onSelect = { viewModel.selectPinLength(it) },
                )

            PinSetupStep.Enter ->
                PinEntryStep(
                    title = stringResource(Res.string.pin_create_title),
                    isConfirmStep = false,
                    pinInput = state.pinInput,
                    pinLength = state.pinLength,
                    error = state.error?.resolve(),
                    isLoading = state.isLoading,
                    onDigit = { viewModel.onDigit(it) },
                    onBackspace = { viewModel.onBackspace() },
                    onSubmit = { viewModel.submit() },
                )

            PinSetupStep.Confirm ->
                PinEntryStep(
                    title = stringResource(Res.string.pin_confirm_title),
                    isConfirmStep = true,
                    pinInput = state.pinInput,
                    pinLength = state.pinLength,
                    error = state.error?.resolve(),
                    isLoading = state.isLoading,
                    onDigit = { viewModel.onDigit(it) },
                    onBackspace = { viewModel.onBackspace() },
                    onSubmit = { viewModel.submit() },
                )
        }

        // Biometric offer dialog
        if (state.showBiometricOffer) {
            if (biometricAvailable) {
                AlertDialog(
                    onDismissRequest = { viewModel.onBiometricDeclined() },
                    title = { Text(stringResource(Res.string.pin_enable_biometric_title)) },
                    text = {
                        Text(stringResource(Res.string.pin_enable_biometric_desc))
                    },
                    confirmButton = {
                        Button(onClick = { viewModel.onBiometricAccepted() }) {
                            Text(stringResource(Res.string.pin_enable))
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { viewModel.onBiometricDeclined() }) {
                            Text(stringResource(Res.string.pin_not_now))
                        }
                    },
                )
            } else {
                LaunchedEffect(Unit) { viewModel.onBiometricDeclined() }
            }
        }

        Spacer(Modifier.height(24.dp))

        Text(
            text = stringResource(Res.string.pin_change_hint),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth(),
        )
    }
}

@Composable
private fun PinLengthChooser(
    selected: Int,
    onSelect: (Int) -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = stringResource(Res.string.pin_choose_length),
            style = MaterialTheme.typography.headlineSmall,
        )

        Spacer(Modifier.height(24.dp))

        Row(
            horizontalArrangement = Arrangement.spacedBy(8.dp),
        ) {
            (4..8).forEach { length ->
                FilterChip(
                    selected = selected == length,
                    onClick = { onSelect(length) },
                    label = { Text("$length") },
                    modifier = Modifier.testTag("pinLength$length"),
                )
            }
        }

        Spacer(Modifier.height(8.dp))

        Text(
            text = stringResource(Res.string.pin_digits),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
    }
}

@Composable
private fun PinEntryStep(
    title: String,
    isConfirmStep: Boolean,
    pinInput: String,
    pinLength: Int,
    error: String?,
    isLoading: Boolean,
    onDigit: (Char) -> Unit,
    onBackspace: () -> Unit,
    onSubmit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineSmall,
        )

        Spacer(Modifier.height(8.dp))

        if (error != null) {
            Text(
                text = error,
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodyMedium,
                modifier = Modifier.semantics { liveRegion = LiveRegionMode.Polite },
            )
        }

        Spacer(Modifier.height(24.dp))

        PinDots(length = pinInput.length, maxLength = pinLength)

        Spacer(Modifier.height(32.dp))

        if (isLoading) {
            CircularProgressIndicator(modifier = Modifier.size(48.dp))
        } else {
            PinKeypad(
                onDigit = onDigit,
                onBackspace = onBackspace,
                onBiometric = null,
            )

            Spacer(Modifier.height(16.dp))

            TextButton(
                onClick = onSubmit,
                enabled = pinInput.length == pinLength,
            ) {
                Text(
                    if (isConfirmStep) {
                        stringResource(Res.string.pin_confirm)
                    } else {
                        stringResource(Res.string.pin_next)
                    },
                )
            }
        }
    }
}
