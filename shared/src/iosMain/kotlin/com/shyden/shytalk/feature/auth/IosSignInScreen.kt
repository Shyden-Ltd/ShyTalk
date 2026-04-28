package com.shyden.shytalk.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.BuildVariant
import com.shyden.shytalk.feature.auth.components.AppleSignInButton
import com.shyden.shytalk.feature.auth.components.GoogleSignInButton
import com.shyden.shytalk.feature.suspension.SuspensionScreen
import com.shyden.shytalk.navigation.SignInScreenParams
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.voice_chat_reimagined
import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.auth.auth
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

@Composable
fun IosSignInScreen(params: SignInScreenParams) {
    val viewModel: AuthViewModel = koinViewModel()
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it.resolveAsync())
            viewModel.clearError()
        }
    }

    val isBanned = uiState.isDeviceBanned || uiState.isNetworkBanned
    LaunchedEffect(uiState.isAuthenticated, uiState.isSuspended, uiState.isBackendUnreachable, isBanned) {
        if (uiState.isAuthenticated && !uiState.isSuspended && !uiState.isBackendUnreachable && !isBanned) {
            params.onAuthSuccess(uiState.hasProfile, uiState.hasDOB, uiState.needsLegalAcceptance)
        }
    }

    // Suspension takes priority — show SuspensionScreen overlay before sign-in UI.
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

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
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

            // Persistent recovery banner. The transient `error` snackbar gets dismissed
            // (`clearError()` runs after the snackbar animates), but `requiresAppDataClear`
            // is sticky — without rendering it explicitly the user sees disabled sign-in
            // buttons with no explanation after the snackbar disappears.
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

            var signingInProvider by remember { mutableStateOf<String?>(null) }

            LaunchedEffect(uiState.isLoading, uiState.error) {
                if (!uiState.isLoading && signingInProvider != null) {
                    signingInProvider = null
                }
            }

            // `requiresAppDataClear` is set when local auth storage couldn't be cleaned up
            // after a sign-out failure — retrying any provider hits the same broken storage
            // and loops. Treat the same as "busy" so all auth buttons stay disabled until
            // the user actually clears app data and restarts.
            val isBusy = uiState.isLoading || signingInProvider != null || uiState.requiresAppDataClear

            // Google Sign-In button
            GoogleSignInButton(
                onClick = {
                    if (isBusy) return@GoogleSignInButton
                    signingInProvider = "google"
                    scope.launch {
                        try {
                            val idToken = performGoogleSignIn()
                            viewModel.signInWithGoogle(idToken)
                        } catch (e: Exception) {
                            signingInProvider = null
                            if (!e.message.orEmpty().contains("cancelled", ignoreCase = true)) {
                                snackbarHostState.showSnackbar(
                                    e.message ?: "Google Sign-In failed",
                                )
                            }
                        }
                    }
                },
                isLoading = signingInProvider == "google",
                enabled = !isBusy,
                modifier = Modifier.testTag("ios_google_sign_in"),
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Apple Sign-In button
            AppleSignInButton(
                onClick = {
                    if (isBusy) return@AppleSignInButton
                    signingInProvider = "apple"
                    scope.launch {
                        try {
                            val result = performAppleSignIn()
                            viewModel.signInWithApple(result.idToken, result.rawNonce)
                        } catch (e: Exception) {
                            signingInProvider = null
                            if (!e.message.orEmpty().contains("cancelled", ignoreCase = true)) {
                                snackbarHostState.showSnackbar(
                                    e.message ?: "Apple Sign-In failed",
                                )
                            }
                        }
                    }
                },
                isLoading = signingInProvider == "apple",
                enabled = !isBusy,
                modifier = Modifier.testTag("ios_apple_sign_in"),
            )

            // Dev-only sign-in for local emulator testing — mirrors the Android picker.
            if (BuildVariant.isLocalEmulator) {
                var showDevPicker by remember { mutableStateOf(false) }

                Spacer(modifier = Modifier.height(24.dp))
                TextButton(
                    onClick = { showDevPicker = true },
                    enabled = !isBusy,
                    modifier = Modifier.testTag("dev_sign_in"),
                ) {
                    Text("Dev Sign-In (local only)", color = MaterialTheme.colorScheme.tertiary)
                }

                if (showDevPicker) {
                    AlertDialog(
                        onDismissRequest = { showDevPicker = false },
                        title = { Text("Choose account") },
                        text = {
                            Column {
                                DEV_ACCOUNTS.forEach { (email, label) ->
                                    TextButton(
                                        onClick = {
                                            showDevPicker = false
                                            // Defence-in-depth: the surrounding picker is
                                            // already gated by isLocalEmulator, but a Frida
                                            // / debugger flip of the flag at runtime is the
                                            // documented S2 risk. Re-check the flag at the
                                            // call site so the auth call refuses.
                                            if (!BuildVariant.isLocalEmulator) return@TextButton
                                            signingInProvider = "dev"
                                            scope.launch {
                                                try {
                                                    Firebase.auth.signInWithEmailAndPassword(
                                                        email,
                                                        "localdev123",
                                                    )
                                                    viewModel.resolveAfterExternalSignIn("email", email)
                                                } catch (e: Exception) {
                                                    signingInProvider = null
                                                    snackbarHostState.showSnackbar(
                                                        e.message ?: "Dev sign-in failed",
                                                    )
                                                }
                                            }
                                        },
                                        modifier =
                                            Modifier
                                                .fillMaxWidth()
                                                .testTag("dev_account_$label"),
                                    ) {
                                        Text("$label ($email)")
                                    }
                                }
                            }
                        },
                        confirmButton = {},
                        dismissButton = {
                            TextButton(
                                onClick = { showDevPicker = false },
                                modifier = Modifier.testTag("dev_picker_cancel"),
                            ) { Text("Cancel") }
                        },
                    )
                }
            }
        }
    }
}

// Accounts that match what local/seed.js actually creates. Tapping any account
// not seeded here would surface ERROR_USER_NOT_FOUND from Firebase, so list
// only the verified seed set. Mirrors Android's local-flavor picker.
//
// TODO(ios-debug-strip): the strings in this list (and the inline shared dev
// password) compile into the iOS Kotlin/Native binary regardless of build
// configuration — Kotlin/Native does not dead-code-eliminate constants based
// on `if (BuildVariant.isLocalEmulator)` branches the way Android's
// `BuildConfig.FLAVOR` does. Eliminating the leak from RELEASE iOS binaries
// requires moving DEV_ACCOUNTS into a Swift `#if DEBUG` section and bridging
// via Koin.
private val DEV_ACCOUNTS =
    listOf(
        "claude-test@shytalk.dev" to "Admin",
        "user@test.com" to "Test User",
    )
