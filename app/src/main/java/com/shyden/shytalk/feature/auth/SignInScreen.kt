package com.shyden.shytalk.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CloudOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.shyden.shytalk.BuildConfig
import com.shyden.shytalk.core.ui.StyledSnackbarHost
import com.shyden.shytalk.core.util.SecureStorage
import com.shyden.shytalk.feature.auth.components.AppleSignInButton
import com.shyden.shytalk.feature.auth.components.GoogleSignInButton
import com.shyden.shytalk.feature.suspension.BanScreen
import com.shyden.shytalk.feature.suspension.SuspensionScreen
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject
import org.koin.compose.viewmodel.koinViewModel

private const val KEY_EMAIL_FOR_LINK = "email_for_sign_in_link"

@Composable
fun SignInScreen(
    pendingEmailLink: String? = null,
    onEmailLinkConsumed: () -> Unit = {},
    onNavigateToEmail: () -> Unit = {},
    onAuthSuccess: (hasProfile: Boolean, hasDOB: Boolean, needsLegalAcceptance: Boolean) -> Unit,
    viewModel: AuthViewModel = koinViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val credentialManager = remember { CredentialManager.create(context) }
    val googleSignInFailed = stringResource(Res.string.google_sign_in_failed)
    val secureStorage: SecureStorage = koinInject()

    // Handle incoming email sign-in deep link
    LaunchedEffect(pendingEmailLink) {
        if (pendingEmailLink != null) {
            val storedEmail = secureStorage.getString(KEY_EMAIL_FOR_LINK)
            if (storedEmail != null) {
                secureStorage.remove(KEY_EMAIL_FOR_LINK)
                viewModel.handleEmailLink(storedEmail, pendingEmailLink)
            }
            onEmailLinkConsumed()
        }
    }

    val isBanned = uiState.isDeviceBanned || uiState.isNetworkBanned

    LaunchedEffect(uiState.isAuthenticated, uiState.isSuspended, uiState.isBackendUnreachable, isBanned) {
        if (uiState.isAuthenticated && !uiState.isSuspended && !uiState.isBackendUnreachable && !isBanned) {
            onAuthSuccess(uiState.hasProfile, uiState.hasDOB, uiState.needsLegalAcceptance)
        }
    }

    // Suspension takes priority over ban — show suspension screen first,
    // with ban details included if the device/network is also banned
    if (uiState.isSuspended) {
        SuspensionScreen(
            reason = uiState.suspensionReason,
            endDate = uiState.suspensionEndDate,
            canAppeal = uiState.suspensionCanAppeal,
            appealStatus = uiState.suspensionAppealStatus,
            onSubmitAppeal = { viewModel.submitAppeal(it) },
            onSignOut = { viewModel.signOut() },
            isLoading = uiState.isLoading,
            isDeviceBanned = uiState.isDeviceBanned,
            isNetworkBanned = uiState.isNetworkBanned,
            banReason = uiState.banReason,
            banExpiresAt = uiState.banExpiresAt,
        )
        return
    }

    if (isBanned) {
        BanScreen(
            banType = if (uiState.isDeviceBanned) "device" else "network",
            reason = uiState.banReason,
            expiresAt = uiState.banExpiresAt,
            onSignOut = { viewModel.signOut() },
        )
        return
    }

    if (uiState.isBackendUnreachable) {
        Scaffold { padding ->
            Column(
                modifier =
                    Modifier
                        .fillMaxSize()
                        .padding(padding)
                        .padding(horizontal = 32.dp),
                verticalArrangement = Arrangement.Center,
                horizontalAlignment = Alignment.CenterHorizontally,
            ) {
                Icon(
                    imageVector = Icons.Default.CloudOff,
                    contentDescription = null,
                    modifier = Modifier.size(64.dp),
                    tint = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                Spacer(modifier = Modifier.height(16.dp))

                Text(
                    text = stringResource(Res.string.unable_to_connect),
                    style = MaterialTheme.typography.headlineSmall,
                    color = MaterialTheme.colorScheme.onSurface,
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = stringResource(Res.string.connection_trouble),
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    modifier = Modifier.fillMaxWidth(),
                )

                Spacer(modifier = Modifier.height(24.dp))

                Button(
                    onClick = { viewModel.retryConnection() },
                    enabled = !uiState.isLoading,
                    modifier = Modifier.fillMaxWidth(),
                ) {
                    if (uiState.isLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            strokeWidth = 2.dp,
                            color = MaterialTheme.colorScheme.onPrimary,
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(stringResource(Res.string.retrying))
                    } else {
                        Text(stringResource(Res.string.retry))
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                Text(
                    text = stringResource(Res.string.contact_support_hint),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        return
    }

    if (uiState.isDeviceLocked) {
        AlertDialog(
            onDismissRequest = { viewModel.clearDeviceLocked() },
            title = { Text(stringResource(Res.string.account_restricted)) },
            text = {
                Text(stringResource(Res.string.device_locked_description))
            },
            confirmButton = {
                TextButton(onClick = { viewModel.clearDeviceLocked() }) {
                    Text(stringResource(Res.string.ok))
                }
            },
        )
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it.resolveAsync())
            viewModel.clearError()
        }
    }

    Scaffold(
        snackbarHost = { StyledSnackbarHost(snackbarHostState) },
    ) { padding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Text(
                text = "ShyTalk",
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.primary,
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = stringResource(Res.string.voice_chat_reimagined),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(modifier = Modifier.height(32.dp))

            // Persistent recovery banner. The transient `error` snackbar is dismissed by
            // `clearError()`, but `requiresAppDataClear` is sticky — without rendering it
            // explicitly the user sees disabled sign-in buttons with no explanation.
            if (uiState.requiresAppDataClear) {
                // UiText.resolve() — toString() returns Kotlin's auto-generated
                // data-class form (`Plain(text=...)`) which leaks the type wrapper
                // to users; resolve() returns the localised string for both
                // `Plain` and `Res` arms.
                val bannerMessage = uiState.error?.resolve().orEmpty()
                Surface(
                    color = MaterialTheme.colorScheme.errorContainer,
                    shape = MaterialTheme.shapes.medium,
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .testTag("storage_corrupted_banner"),
                ) {
                    Text(
                        text = bannerMessage,
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(16.dp),
                    )
                }
                Spacer(modifier = Modifier.height(16.dp))
            }

            // Track which provider is actively signing in (null = none)
            var signingInProvider by remember { mutableStateOf<String?>(null) }

            // Clear local signing-in state when ViewModel finishes loading (success, error, or cancel)
            LaunchedEffect(uiState.isLoading, uiState.error) {
                if (!uiState.isLoading && signingInProvider != null) {
                    signingInProvider = null
                }
            }

            // `requiresAppDataClear` (set when sign-out / clearCredential threw and local
            // auth storage is half-cleared) keeps auth actions disabled — retrying any
            // provider would just hit the same broken storage. User must clear app data.
            val isBusy = uiState.isLoading || signingInProvider != null || uiState.requiresAppDataClear

            // Google Sign-In button (branded)
            GoogleSignInButton(
                onClick = {
                    if (isBusy) return@GoogleSignInButton
                    signingInProvider = "google"
                    scope.launch {
                        try {
                            val googleIdOption =
                                GetGoogleIdOption
                                    .Builder()
                                    .setFilterByAuthorizedAccounts(false)
                                    .setServerClientId(BuildConfig.WEB_CLIENT_ID)
                                    .build()

                            val request =
                                GetCredentialRequest
                                    .Builder()
                                    .addCredentialOption(googleIdOption)
                                    .build()

                            val result =
                                credentialManager.getCredential(
                                    request = request,
                                    context = context,
                                )

                            val googleIdToken =
                                GoogleIdTokenCredential
                                    .createFrom(result.credential.data)
                                    .idToken

                            viewModel.signInWithGoogle(googleIdToken)
                        } catch (_: GetCredentialCancellationException) {
                            signingInProvider = null
                        } catch (e: Exception) {
                            signingInProvider = null
                            snackbarHostState.showSnackbar(
                                e.message ?: googleSignInFailed,
                            )
                        }
                    }
                },
                isLoading = signingInProvider == "google" || (uiState.isLoading && signingInProvider == "google"),
                enabled = !isBusy,
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Apple Sign-In button (branded)
            AppleSignInButton(
                onClick = {
                    if (isBusy) return@AppleSignInButton
                    val activity = context as? android.app.Activity ?: return@AppleSignInButton
                    signingInProvider = "apple"
                    viewModel.signInWithAppleViaProvider(activity)
                },
                isLoading = signingInProvider == "apple" || (uiState.isLoading && signingInProvider == "apple"),
                enabled = !isBusy,
            )

            // Email Sign-In hidden — pending self-hosted mail server implementation
            // Spacer(modifier = Modifier.height(12.dp))
            // EmailSignInButton(onClick = onNavigateToEmail)

            // Dev-only sign-in for local emulator testing
            if (BuildConfig.FLAVOR == "local") {
                Spacer(modifier = Modifier.height(24.dp))
                TextButton(
                    onClick = {
                        if (isBusy) return@TextButton
                        signingInProvider = "dev"
                        scope.launch {
                            try {
                                com.google.firebase.auth.FirebaseAuth
                                    .getInstance()
                                    .signInWithEmailAndPassword("claude-test@shytalk.dev", "localdev123")
                                    .await()
                                viewModel.resolveAfterExternalSignIn("email", "claude-test@shytalk.dev")
                            } catch (e: Exception) {
                                signingInProvider = null
                                snackbarHostState.showSnackbar(e.message ?: "Dev sign-in failed")
                            }
                        }
                    },
                    enabled = !isBusy,
                    modifier = Modifier.testTag("dev_sign_in"),
                ) {
                    Text("Dev Sign-In (local only)", color = MaterialTheme.colorScheme.tertiary)
                }
            }
        }
    }
}
