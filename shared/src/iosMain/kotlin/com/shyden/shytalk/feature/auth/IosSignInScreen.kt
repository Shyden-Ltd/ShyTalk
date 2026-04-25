package com.shyden.shytalk.feature.auth

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
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
import com.shyden.shytalk.feature.auth.components.AppleSignInButton
import com.shyden.shytalk.feature.auth.components.EmailSignInButton
import com.shyden.shytalk.feature.auth.components.GoogleSignInButton
import com.shyden.shytalk.navigation.SignInScreenParams
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.voice_chat_reimagined
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

            var signingInProvider by remember { mutableStateOf<String?>(null) }

            LaunchedEffect(uiState.isLoading, uiState.error) {
                if (!uiState.isLoading && signingInProvider != null) {
                    signingInProvider = null
                }
            }

            val isBusy = uiState.isLoading || signingInProvider != null

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

            // Email Sign-In hidden — pending self-hosted mail server implementation
            // Spacer(modifier = Modifier.height(12.dp))
            // EmailSignInButton(
            //     onClick = {
            //         if (isBusy) return@EmailSignInButton
            //         params.onNavigateToEmail()
            //     },
            //     modifier = Modifier.testTag("ios_email_sign_in"),
            // )
        }
    }
}
