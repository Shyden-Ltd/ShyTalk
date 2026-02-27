package com.shyden.shytalk.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import org.koin.compose.viewmodel.koinViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.shyden.shytalk.feature.suspension.SuspensionScreen
import kotlinx.coroutines.launch

private const val WEB_CLIENT_ID =
    "517834977595-cdu78p6q7vg57utpsvtik04c195lbh8b.apps.googleusercontent.com"

@Composable
fun GoogleSignInScreen(
    onAuthSuccess: (hasProfile: Boolean, hasDOB: Boolean, needsLegalAcceptance: Boolean) -> Unit,
    viewModel: AuthViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val credentialManager = remember { CredentialManager.create(context) }

    LaunchedEffect(uiState.isAuthenticated, uiState.isSuspended) {
        if (uiState.isAuthenticated && !uiState.isSuspended) {
            onAuthSuccess(uiState.hasProfile, uiState.hasDOB, uiState.needsLegalAcceptance)
        }
    }

    if (uiState.isSuspended) {
        SuspensionScreen(
            reason = uiState.suspensionReason,
            endDate = uiState.suspensionEndDate,
            canAppeal = uiState.suspensionCanAppeal,
            appealStatus = uiState.suspensionAppealStatus,
            onSubmitAppeal = { viewModel.submitAppeal(it) },
            onSignOut = { viewModel.signOut() },
            isLoading = uiState.isLoading
        )
        return
    }

    if (uiState.isDeviceLocked) {
        AlertDialog(
            onDismissRequest = { viewModel.clearDeviceLocked() },
            title = { Text("Account Restricted") },
            text = {
                Text(
                    "This device is already linked to another account.\n" +
                        "Only one account is allowed per device.\n\n" +
                        "For support, contact shytalk.help@gmail.com"
                )
            },
            confirmButton = {
                TextButton(onClick = { viewModel.clearDeviceLocked() }) {
                    Text("OK")
                }
            }
        )
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = "ShyTalk",
                style = MaterialTheme.typography.headlineLarge,
                color = MaterialTheme.colorScheme.primary
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = "Voice chat rooms, reimagined.",
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(32.dp))

            if (uiState.isLoading) {
                CircularProgressIndicator(modifier = Modifier.testTag("signIn_loadingIndicator"))
            } else {
                Button(
                    onClick = {
                        scope.launch {
                            try {
                                val googleIdOption = GetGoogleIdOption.Builder()
                                    .setFilterByAuthorizedAccounts(false)
                                    .setServerClientId(WEB_CLIENT_ID)
                                    .build()

                                val request = GetCredentialRequest.Builder()
                                    .addCredentialOption(googleIdOption)
                                    .build()

                                val result = credentialManager.getCredential(
                                    request = request,
                                    context = context
                                )

                                val googleIdToken = GoogleIdTokenCredential
                                    .createFrom(result.credential.data)
                                    .idToken

                                viewModel.signInWithGoogle(googleIdToken)
                            } catch (_: GetCredentialCancellationException) {
                                // User cancelled - do nothing
                            } catch (e: Exception) {
                                snackbarHostState.showSnackbar(
                                    e.message ?: "Google sign-in failed"
                                )
                            }
                        }
                    },
                    modifier = Modifier.fillMaxWidth().testTag("signIn_googleButton")
                ) {
                    Text("Sign in with Google")
                }
            }
        }
    }
}
