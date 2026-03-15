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
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.input.ImeAction
import androidx.compose.ui.text.input.KeyboardType
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.shyden.shytalk.core.util.DisposableEmailDomains
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.*
import kotlinx.coroutines.delay
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

private const val RESEND_COOLDOWN_SECONDS = 60

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun EmailSignInScreen(
    onNavigateBack: () -> Unit,
    onStoreEmail: (String) -> Unit,
    viewModel: AuthViewModel = koinViewModel(),
    modifier: Modifier = Modifier
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    val errorDisposableEmail = stringResource(Res.string.error_disposable_email)
    val errorInvalidLink = stringResource(Res.string.error_invalid_email_link)

    // Show ViewModel errors in snackbar
    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it.resolveAsync())
            viewModel.clearError()
        }
    }

    Scaffold(
        modifier = modifier,
        snackbarHost = {
            SnackbarHost(snackbarHostState) { data ->
                androidx.compose.material3.Snackbar(
                    snackbarData = data,
                    containerColor = androidx.compose.material3.MaterialTheme.colorScheme.errorContainer,
                    contentColor = androidx.compose.material3.MaterialTheme.colorScheme.onErrorContainer,
                    actionColor = androidx.compose.material3.MaterialTheme.colorScheme.error,
                    shape = androidx.compose.foundation.shape.RoundedCornerShape(12.dp)
                )
            }
        },
        topBar = {
            TopAppBar(
                title = {},
                navigationIcon = {
                    IconButton(
                        onClick = onNavigateBack,
                        modifier = Modifier.testTag("emailSignIn_backButton")
                    ) {
                        Icon(
                            imageVector = Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(Res.string.back)
                        )
                    }
                }
            )
        }
    ) { padding ->
        if (uiState.awaitingEmailLink) {
            AwaitingLinkContent(
                email = uiState.emailForLink ?: "",
                isLoading = uiState.isLoading,
                onSubmitLink = { link ->
                    if (!link.startsWith("https://")) {
                        scope.launch {
                            snackbarHostState.showSnackbar(errorInvalidLink)
                        }
                    } else {
                        val email = uiState.emailForLink ?: ""
                        viewModel.handleEmailLink(email, link)
                    }
                },
                onResend = { email ->
                    onStoreEmail(email)
                    viewModel.signInWithEmail(email)
                },
                onChangeEmail = {
                    // Reset the awaiting state so the email input shows again
                    viewModel.clearAwaitingEmailLink()
                },
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 32.dp)
            )
        } else {
            EmailInputContent(
                isLoading = uiState.isLoading,
                onSend = { email ->
                    if (DisposableEmailDomains.isDisposable(email)) {
                        scope.launch {
                            snackbarHostState.showSnackbar(errorDisposableEmail)
                        }
                    } else {
                        onStoreEmail(email)
                        viewModel.signInWithEmail(email)
                    }
                },
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 32.dp)
            )
        }
    }
}

@Composable
private fun EmailInputContent(
    isLoading: Boolean,
    onSend: (String) -> Unit,
    modifier: Modifier = Modifier
) {
    var emailInput by remember { mutableStateOf("") }
    val isValidEmail = emailInput.contains("@") && emailInput.contains(".")

    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .imePadding(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = Icons.Default.Email,
            contentDescription = null,
            modifier = Modifier.size(48.dp),
            tint = MaterialTheme.colorScheme.primary
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = stringResource(Res.string.sign_in_with_email),
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onSurface
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = stringResource(Res.string.email_sign_in_description),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(24.dp))

        OutlinedTextField(
            value = emailInput,
            onValueChange = { emailInput = it },
            label = { Text(stringResource(Res.string.email_hint)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(
                keyboardType = KeyboardType.Email,
                imeAction = ImeAction.Done
            ),
            keyboardActions = KeyboardActions(
                onDone = {
                    if (isValidEmail && !isLoading) {
                        onSend(emailInput.trim())
                    }
                }
            ),
            modifier = Modifier
                .fillMaxWidth()
                .testTag("emailSignIn_emailField")
        )

        Spacer(modifier = Modifier.height(16.dp))

        Button(
            onClick = { onSend(emailInput.trim()) },
            enabled = isValidEmail && !isLoading,
            modifier = Modifier.fillMaxWidth().testTag("emailSignIn_sendButton")
        ) {
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.onPrimary
                )
            } else {
                Text(stringResource(Res.string.send_link))
            }
        }
    }
}

@Composable
private fun AwaitingLinkContent(
    email: String,
    isLoading: Boolean,
    onSubmitLink: (String) -> Unit,
    onResend: (String) -> Unit,
    onChangeEmail: () -> Unit,
    modifier: Modifier = Modifier
) {
    var resendCooldown by remember { mutableIntStateOf(0) }
    var linkInput by remember { mutableStateOf("") }
    val scope = rememberCoroutineScope()

    // Start the resend cooldown timer when this content first appears
    LaunchedEffect(Unit) {
        resendCooldown = RESEND_COOLDOWN_SECONDS
        while (resendCooldown > 0) {
            delay(1_000L)
            resendCooldown--
        }
    }

    Column(
        modifier = modifier
            .verticalScroll(rememberScrollState())
            .imePadding(),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally
    ) {
        Icon(
            imageVector = Icons.Default.Email,
            contentDescription = null,
            modifier = Modifier.size(64.dp),
            tint = MaterialTheme.colorScheme.primary
        )

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = stringResource(Res.string.email_link_sent),
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onSurface
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = stringResource(Res.string.email_link_sent_to, email),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(24.dp))

        // Step 1: Tap the link in your email (primary path via deep link)
        Text(
            text = stringResource(Res.string.email_link_step1),
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurface,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(16.dp))

        // Step 2: Or paste the link here (fallback)
        Text(
            text = stringResource(Res.string.email_link_step2),
            style = MaterialTheme.typography.bodySmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center,
            modifier = Modifier.fillMaxWidth()
        )

        Spacer(modifier = Modifier.height(8.dp))

        OutlinedTextField(
            value = linkInput,
            onValueChange = { linkInput = it },
            label = { Text(stringResource(Res.string.paste_link)) },
            singleLine = true,
            keyboardOptions = KeyboardOptions(imeAction = ImeAction.Done),
            keyboardActions = KeyboardActions(
                onDone = {
                    if (linkInput.isNotBlank()) {
                        onSubmitLink(linkInput.trim())
                    }
                }
            ),
            modifier = Modifier
                .fillMaxWidth()
                .testTag("emailSignIn_linkField")
        )

        Spacer(modifier = Modifier.height(8.dp))

        OutlinedButton(
            onClick = { onSubmitLink(linkInput.trim()) },
            enabled = linkInput.isNotBlank() && !isLoading,
            modifier = Modifier.fillMaxWidth().testTag("emailSignIn_pasteButton")
        ) {
            if (isLoading) {
                CircularProgressIndicator(
                    modifier = Modifier.size(20.dp),
                    strokeWidth = 2.dp,
                    color = MaterialTheme.colorScheme.primary
                )
            } else {
                Text(stringResource(Res.string.verify))
            }
        }

        Spacer(modifier = Modifier.height(12.dp))

        val resendLabel = if (resendCooldown > 0) {
            "${stringResource(Res.string.resend_link)} (${resendCooldown}s)"
        } else {
            stringResource(Res.string.resend_link)
        }

        TextButton(
            onClick = {
                if (resendCooldown <= 0) {
                    scope.launch {
                        resendCooldown = RESEND_COOLDOWN_SECONDS
                        onResend(email)
                        while (resendCooldown > 0) {
                            delay(1_000L)
                            resendCooldown--
                        }
                    }
                }
            },
            enabled = resendCooldown <= 0 && !isLoading,
            modifier = Modifier.fillMaxWidth().testTag("emailSignIn_resendButton")
        ) {
            Text(resendLabel)
        }

        Spacer(modifier = Modifier.height(8.dp))

        TextButton(
            onClick = onChangeEmail,
            modifier = Modifier.testTag("emailSignIn_changeEmailLink")
        ) {
            Text(
                text = stringResource(Res.string.use_different_email),
                color = MaterialTheme.colorScheme.primary
            )
        }
    }
}
