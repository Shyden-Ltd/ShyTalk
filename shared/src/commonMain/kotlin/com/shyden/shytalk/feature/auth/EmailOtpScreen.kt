package com.shyden.shytalk.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.text.KeyboardActions
import androidx.compose.foundation.text.KeyboardOptions
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Email
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.shyden.shytalk.core.ui.StyledSnackbarHost
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmailOtpScreen(
    onNavigateBack: () -> Unit,
    onAuthSuccess: (String) -> Unit,
    viewModel: EmailOtpViewModel = koinViewModel(),
    modifier: Modifier = Modifier,
) {
    val state by viewModel.state.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(state.error) {
        state.error?.let { snackbarHostState.showSnackbar(it.resolveAsync()) }
    }

    LaunchedEffect(state.customToken) {
        state.customToken?.let { onAuthSuccess(it) }
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(Res.string.email_sign_in_title)) },
                navigationIcon = {
                    IconButton(onClick = {
                        if (state.step == EmailOtpStep.EnterCode) {
                            viewModel.goBack()
                        } else {
                            onNavigateBack()
                        }
                    }) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back))
                    }
                },
            )
        },
        snackbarHost = { StyledSnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(
            modifier =
                modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 24.dp)
                    .verticalScroll(rememberScrollState())
                    .imePadding()
                    .testTag("emailOtpScreen"),
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
        ) {
            when (state.step) {
                EmailOtpStep.EnterEmail ->
                    EmailStep(
                        email = state.email,
                        isLoading = state.isLoading,
                        onEmailChange = { viewModel.updateEmail(it) },
                        onSubmit = { viewModel.sendOtp() },
                    )

                EmailOtpStep.EnterCode ->
                    CodeStep(
                        email = state.email,
                        code = state.code,
                        isLoading = state.isLoading,
                        resendCooldown = state.resendCooldown,
                        onCodeChange = { viewModel.updateCode(it) },
                        onSubmit = { viewModel.verifyOtp() },
                        onResend = { viewModel.resendOtp() },
                    )
            }
        }
    }
}

@Composable
private fun EmailStep(
    email: String,
    isLoading: Boolean,
    onEmailChange: (String) -> Unit,
    onSubmit: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Icon(
            Icons.Default.Email,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.primary,
        )

        Spacer(Modifier.height(16.dp))

        Text(
            text = stringResource(Res.string.email_enter_address),
            style = MaterialTheme.typography.bodyLarge,
        )

        Spacer(Modifier.height(24.dp))

        OutlinedTextField(
            value = email,
            onValueChange = onEmailChange,
            label = { Text(stringResource(Res.string.email_label)) },
            singleLine = true,
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = KeyboardType.Email,
                    imeAction = ImeAction.Done,
                ),
            keyboardActions = KeyboardActions(onDone = { onSubmit() }),
            modifier =
                Modifier
                    .fillMaxWidth()
                    .testTag("emailInput"),
        )

        Spacer(Modifier.height(24.dp))

        Button(
            onClick = onSubmit,
            enabled = !isLoading && email.isNotBlank(),
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            } else {
                Text(stringResource(Res.string.email_send_code))
            }
        }
    }
}

@Composable
private fun CodeStep(
    email: String,
    code: String,
    isLoading: Boolean,
    resendCooldown: Int,
    onCodeChange: (String) -> Unit,
    onSubmit: () -> Unit,
    onResend: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(
            text = stringResource(Res.string.email_code_sent_to),
            style = MaterialTheme.typography.bodyLarge,
        )
        Text(
            text = email,
            style = MaterialTheme.typography.bodyLarge,
            color = MaterialTheme.colorScheme.primary,
        )

        Spacer(Modifier.height(24.dp))

        OutlinedTextField(
            value = code,
            onValueChange = onCodeChange,
            label = { Text(stringResource(Res.string.email_code_label)) },
            singleLine = true,
            keyboardOptions =
                KeyboardOptions(
                    keyboardType = KeyboardType.Number,
                    imeAction = ImeAction.Done,
                ),
            keyboardActions = KeyboardActions(onDone = { onSubmit() }),
            modifier =
                Modifier
                    .fillMaxWidth()
                    .testTag("codeInput"),
        )

        Spacer(Modifier.height(24.dp))

        Button(
            onClick = onSubmit,
            enabled = !isLoading && code.length == 6,
            modifier = Modifier.fillMaxWidth(),
        ) {
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            } else {
                Text(stringResource(Res.string.email_verify))
            }
        }

        Spacer(Modifier.height(16.dp))

        TextButton(
            onClick = onResend,
            enabled = resendCooldown == 0 && !isLoading,
        ) {
            Text(
                if (resendCooldown > 0) {
                    stringResource(Res.string.email_resend_in, resendCooldown)
                } else {
                    stringResource(Res.string.email_resend_code)
                },
            )
        }

        Spacer(Modifier.height(8.dp))

        Text(
            text = stringResource(Res.string.email_code_expires),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
        )
    }
}
