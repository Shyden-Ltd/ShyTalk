package com.shyden.shytalk.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.credentials.CredentialManager
import androidx.credentials.GetCredentialRequest
import androidx.credentials.exceptions.GetCredentialCancellationException
import org.koin.compose.viewmodel.koinViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.google.android.libraries.identity.googleid.GetGoogleIdOption
import com.google.android.libraries.identity.googleid.GoogleIdTokenCredential
import com.shyden.shytalk.feature.suspension.SuspensionScreen
import com.shyden.shytalk.ui.components.CnyRoomBackground
import com.shyden.shytalk.ui.theme.CnyGold
import kotlinx.coroutines.launch

private const val WEB_CLIENT_ID =
    "517834977595-cdu78p6q7vg57utpsvtik04c195lbh8b.apps.googleusercontent.com"

private val SubtitleWhite = Color.White.copy(alpha = 0.85f)

@Composable
fun GoogleSignInScreen(
    onAuthSuccess: (hasProfile: Boolean, hasDOB: Boolean) -> Unit,
    viewModel: AuthViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val credentialManager = remember { CredentialManager.create(context) }

    LaunchedEffect(uiState.isAuthenticated, uiState.isSuspended) {
        if (uiState.isAuthenticated && !uiState.isSuspended) {
            onAuthSuccess(uiState.hasProfile, uiState.hasDOB)
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

    Box(modifier = Modifier.fillMaxSize()) {
        // Festive animated background
        CnyRoomBackground(modifier = Modifier.fillMaxSize())

        Scaffold(
            containerColor = Color.Transparent,
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
                    text = "\uD83C\uDFEE \uD83D\uDC0E \uD83C\uDFEE",
                    style = MaterialTheme.typography.displayLarge
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = "ShyTalk",
                    style = MaterialTheme.typography.headlineLarge,
                    color = CnyGold
                )

                Spacer(modifier = Modifier.height(8.dp))

                Text(
                    text = "Happy New Year! Connect through voice",
                    style = MaterialTheme.typography.bodyMedium,
                    color = SubtitleWhite
                )

                Text(
                    text = "Year of the Horse 2026",
                    style = MaterialTheme.typography.labelMedium,
                    color = CnyGold
                )

                Spacer(modifier = Modifier.height(4.dp))

                Text(
                    text = "\u606D\u559C\u767C\u8CA1",
                    style = MaterialTheme.typography.titleMedium,
                    color = CnyGold
                )

                Spacer(modifier = Modifier.height(32.dp))

                if (uiState.isLoading) {
                    CircularProgressIndicator(color = CnyGold)
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
                        modifier = Modifier.fillMaxWidth(),
                        colors = ButtonDefaults.buttonColors(
                            containerColor = CnyGold,
                            contentColor = Color.Black
                        )
                    ) {
                        Text("Sign in with Google")
                    }
                }
            }
        }
    }
}
