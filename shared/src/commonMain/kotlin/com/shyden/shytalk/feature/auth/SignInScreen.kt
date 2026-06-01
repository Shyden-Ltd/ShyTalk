package com.shyden.shytalk.feature.auth

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.RoundedCornerShape
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
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.shyden.shytalk.core.BuildVariant
import com.shyden.shytalk.core.DevPersona
import com.shyden.shytalk.core.devPersonas
import com.shyden.shytalk.core.ui.StyledSnackbarHost
import com.shyden.shytalk.core.util.SecureStorage
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.core.util.rememberPlatformActivity
import com.shyden.shytalk.feature.auth.components.AppleSignInButton
import com.shyden.shytalk.feature.auth.components.GoogleSignInButton
import com.shyden.shytalk.feature.suspension.BanScreen
import com.shyden.shytalk.feature.suspension.SuspensionScreen
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.account_restricted
import com.shyden.shytalk.resources.apple_sign_in_failed
import com.shyden.shytalk.resources.connection_trouble
import com.shyden.shytalk.resources.contact_support_hint
import com.shyden.shytalk.resources.device_locked_description
import com.shyden.shytalk.resources.google_sign_in_failed
import com.shyden.shytalk.resources.ok
import com.shyden.shytalk.resources.retry
import com.shyden.shytalk.resources.retrying
import com.shyden.shytalk.resources.sign_in_not_available_on_local
import com.shyden.shytalk.resources.unable_to_connect
import com.shyden.shytalk.resources.voice_chat_reimagined
import kotlinx.coroutines.launch
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
    // Returns the hosting Activity on Android (Compose host's `LocalContext`
    // walked for the wrapping ContextWrapper), `null` on iOS / JVM.
    val activity = rememberPlatformActivity()
    val scope = rememberCoroutineScope()
    val googleSignInFailed = stringResource(Res.string.google_sign_in_failed)
    val appleSignInFailed = stringResource(Res.string.apple_sign_in_failed)
    val signInNotAvailableOnLocal = stringResource(Res.string.sign_in_not_available_on_local)
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

    // Inconsistent-state guard (PR 5b 2026-05-04): user has
    // ageVerified=true but no dateOfBirth on file. Block them; surface
    // the static error code so support can identify the data
    // inconsistency from a screenshot.
    if (uiState.isBlockedByVerifiedNoDob) {
        AccountErrorScreen(
            errorCode = uiState.blockedErrorCode ?: "AGE_VERIF_NO_DOB_E001",
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
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .testTag("signIn_retryConnection"),
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
                TextButton(
                    onClick = { viewModel.clearDeviceLocked() },
                    modifier = Modifier.testTag("signIn_deviceLockedOk"),
                ) {
                    Text(stringResource(Res.string.ok))
                }
            },
        )
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            // Both Android and iOS Apple Sign-In paths now route user
            // cancellations through the typed
            // `AppleSignInCancelledException` attached to
            // `Resource.Error.exception` — `AuthViewModel` branches on
            // the type and never lands a "cancelled" string in
            // `uiState.error`. So whatever lands here is a real failure
            // worth surfacing to the user.
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
            var showPersonaPicker by remember { mutableStateOf(false) }

            LaunchedEffect(uiState.isLoading, uiState.error) {
                if (!uiState.isLoading && signingInProvider != null) {
                    signingInProvider = null
                }
            }

            // `requiresAppDataClear` (set when sign-out / clearCredential threw and local
            // auth storage is half-cleared) keeps auth actions disabled — retrying any
            // provider would just hit the same broken storage. User must clear app data.
            val isBusy = uiState.isLoading || signingInProvider != null || uiState.requiresAppDataClear

            // Google Sign-In button. The CredentialManager flow lives in
            // `shared/androidMain/.../GoogleSignInHelper.android.kt`; iOS
            // routes through the Swift bridge registered in iOSApp.swift.
            // Both paths throw `GoogleSignInCancelledException` on user
            // dismiss so the catch block is uniform here.
            //
            // Operator directive 2026-05-29: button is VISIBLE on every
            // flavor (local, dev, prod). Tapping on local — where
            // `isOAuthSignInFunctional` is false because no real OAuth
            // client redeems against the Firebase Auth emulator — surfaces
            // a clean "Sign-in not available on local environment"
            // snackbar instead of either hiding the button (confusing) or
            // attempting `performGoogleSignIn` with a placeholder client
            // ID and surfacing a cryptic Google framework error.
            if (BuildVariant.isOAuthSignInVisible) {
                GoogleSignInButton(
                    onClick = {
                        if (isBusy) return@GoogleSignInButton
                        if (!BuildVariant.isOAuthSignInFunctional) {
                            // Local-flavor tap — show the localized friendly
                            // message. Don't set `signingInProvider` so the
                            // button stays enabled for the next attempt
                            // after the snackbar dismisses.
                            scope.launch {
                                snackbarHostState.showSnackbar(signInNotAvailableOnLocal)
                            }
                            return@GoogleSignInButton
                        }
                        signingInProvider = "google"
                        scope.launch {
                            try {
                                val googleIdToken =
                                    performGoogleSignIn(
                                        context = activity,
                                        webClientId = BuildVariant.googleWebClientId,
                                    )
                                viewModel.signInWithGoogle(googleIdToken)
                            } catch (e: kotlinx.coroutines.CancellationException) {
                                throw e
                            } catch (_: GoogleSignInCancelledException) {
                                // User dismissed the picker — silent, no toast.
                            } catch (e: GoogleSignInNoAccountException) {
                                // User-fixable: no Google account on device.
                                // The exception's message is hand-authored to be
                                // user-actionable ("Add a Google account in
                                // Settings…"), so we surface it verbatim.
                                snackbarHostState.showSnackbar(
                                    e.message ?: googleSignInFailed,
                                )
                            } catch (e: Exception) {
                                // Generic catch: do NOT pass `e.message` to the
                                // snackbar — Firebase / CredentialManager / Swift
                                // bridge messages are developer-grade and would
                                // leak SDK internals to users. Log the full
                                // exception for triage and show the localised
                                // string only.
                                logW("SignInScreen", "Google sign-in failed", e)
                                snackbarHostState.showSnackbar(googleSignInFailed)
                            } finally {
                                signingInProvider = null
                            }
                        }
                    },
                    isLoading = signingInProvider == "google" || (uiState.isLoading && signingInProvider == "google"),
                    enabled = !isBusy,
                )

                Spacer(modifier = Modifier.height(12.dp))
            } // close if (BuildVariant.isOAuthSignInVisible)

            // Apple Sign-In button. Cross-platform `performAppleSignInFlow`
            // wraps Firebase WebView OAuth on Android (needs the Activity)
            // and ASAuthorizationController on iOS (ignores the activity).
            //
            // Operator directive 2026-05-29: button is VISIBLE on every
            // flavor. Tapping on local surfaces a clean "Sign-in not
            // available on local environment" snackbar instead of routing
            // through Firebase WebView OAuth against the emulator (which
            // doesn't redeem Apple ID tokens and would surface a cryptic
            // SDK error). The visibility gate matches the Google button
            // above so the two surfaces are kept in lock-step.
            if (BuildVariant.isOAuthSignInVisible) {
                AppleSignInButton(
                    onClick = {
                        if (isBusy) return@AppleSignInButton
                        if (!BuildVariant.isOAuthSignInFunctional) {
                            // Local-flavor tap — show the localized friendly
                            // message. Don't set `signingInProvider` so the
                            // button stays enabled for the next attempt.
                            scope.launch {
                                snackbarHostState.showSnackbar(signInNotAvailableOnLocal)
                            }
                            return@AppleSignInButton
                        }
                        signingInProvider = "apple"
                        scope.launch {
                            try {
                                performAppleSignInFlow(viewModel = viewModel, activity = activity)
                            } catch (e: kotlinx.coroutines.CancellationException) {
                                throw e
                            } catch (_: AppleSignInCancelledException) {
                                // User dismissed — silent, no toast.
                            } catch (e: Exception) {
                                // Generic catch: do NOT pass `e.message` — Apple
                                // SDK / Firebase WebView messages are developer-
                                // grade. See Google catch for full reasoning.
                                logW("SignInScreen", "Apple sign-in failed", e)
                                snackbarHostState.showSnackbar(appleSignInFailed)
                            } finally {
                                signingInProvider = null
                            }
                        }
                    },
                    isLoading = signingInProvider == "apple" || (uiState.isLoading && signingInProvider == "apple"),
                    enabled = !isBusy,
                    // testTag is set inside AppleSignInButton; not duplicating here.
                )
            } // close if (BuildVariant.isOAuthSignInVisible)

            // Email Sign-In hidden — pending self-hosted mail server implementation
            // Spacer(modifier = Modifier.height(12.dp))
            // EmailSignInButton(onClick = onNavigateToEmail)

            // Persona-picker sign-in. The picker lets QA operators pick
            // from the 17 test personas (P-02..P-19) so journey scenarios that target
            // a specific persona (e.g. j04 Hayato DOB-flip, j08 Vexa cross-
            // cohort prober) can run against the right Firebase identity
            // without a rebuild between personas.
            //
            // Outer gate ([BuildVariant.isDevAffordancesVisible]) hides
            // the button on PROD regardless of any credential misconfig
            // (operator directive 2026-05-29). The inner re-check below
            // ([BuildVariant.isPersonaPickerAvailable]) covers the
            // misconfigured-dev-build case (button visible but no baked
            // password) — the picker dialog uses the inner credential
            // check to render an actionable empty state.
            //
            // Available on:
            //   - local flavor (hardcoded "localdev123"; matches local/seed.js
            //     which seeds the 17 personas into the Firebase Auth emulator
            //     with that password)
            //   - dev flavor when built with `-PDEV_QA_PERSONAS_PASSWORD=…`
            //     or `DEV_QA_PERSONAS_PASSWORD=…` env var. The value must
            //     match the `PERSONAS_PASSWORD` env var the express-api
            //     provisioner used to create the persona accounts on dev
            //     Firebase Auth.
            if (BuildVariant.isDevAffordancesVisible) {
                Spacer(modifier = Modifier.height(12.dp))
                TextButton(
                    onClick = { showPersonaPicker = true },
                    enabled = !isBusy,
                    modifier = Modifier.testTag("persona_picker_open"),
                ) {
                    Text(
                        "Sign in as test persona",
                        color = MaterialTheme.colorScheme.tertiary,
                    )
                }
            }

            // Persona picker dialog. Shown only when explicitly opened by
            // the button above. Defence-in-depth re-check of
            // isPersonaPickerAvailable inside the click handler protects
            // against a misconfigured prod build where the visibility
            // gate is somehow bypassed (Frida-style runtime patching) —
            // the inner check fails closed and never reaches Firebase
            // Auth with the persona password.
            if (showPersonaPicker && BuildVariant.isPersonaPickerAvailable) {
                AlertDialog(
                    onDismissRequest = { if (!isBusy) showPersonaPicker = false },
                    confirmButton = {},
                    dismissButton = {
                        TextButton(
                            onClick = { showPersonaPicker = false },
                            enabled = !isBusy,
                        ) { Text("Cancel") }
                    },
                    title = { Text("Sign in as test persona") },
                    text = {
                        // Bounded height so the dialog scrolls rather than
                        // pushing the buttons off-screen on a short device.
                        // `exposeTestTagsToPlatformDumps()` is required so the
                        // per-row testTags ("persona_row_P-NN") propagate to
                        // uiautomator's resource-id — Material3 AlertDialog
                        // renders in a separate Popup Compose window which
                        // doesn't inherit MainActivity's semantics modifier.
                        // Without this, the j09 runner driver can't locate
                        // any row in the picker (2026-05-30 finding).
                        LazyColumn(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .heightIn(max = 400.dp)
                                    .exposeTestTagsToPlatformDumps()
                                    .testTag("persona_picker_list"),
                        ) {
                            items(devPersonas, key = { it.id }) { persona ->
                                PersonaPickerRow(
                                    persona = persona,
                                    enabled = !isBusy,
                                    onClick = {
                                        if (isBusy) return@PersonaPickerRow
                                        val sharedPw = BuildVariant.localDevPersonasPassword
                                        if (sharedPw.isNullOrEmpty()) {
                                            logW(
                                                "SignInScreen",
                                                "Persona picker invoked but localDevPersonasPassword is empty",
                                            )
                                            return@PersonaPickerRow
                                        }
                                        showPersonaPicker = false
                                        signingInProvider = "dev"
                                        scope.launch {
                                            try {
                                                performDevSignIn(
                                                    email = persona.email,
                                                    password = sharedPw,
                                                )
                                                viewModel.resolveAfterExternalSignIn(
                                                    "email",
                                                    persona.email,
                                                )
                                            } catch (e: kotlinx.coroutines.CancellationException) {
                                                throw e
                                            } catch (e: Exception) {
                                                logW(
                                                    "SignInScreen",
                                                    "Persona sign-in failed for ${persona.id}",
                                                    e,
                                                )
                                                snackbarHostState.showSnackbar(
                                                    "Persona sign-in failed",
                                                )
                                            } finally {
                                                signingInProvider = null
                                            }
                                        }
                                    },
                                )
                            }
                        }
                    },
                )
            }
        }
    }
}

@Composable
private fun PersonaPickerRow(
    persona: DevPersona,
    enabled: Boolean,
    onClick: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(enabled = enabled, onClick = onClick)
                .padding(vertical = 12.dp, horizontal = 8.dp)
                .testTag("persona_row_${persona.id}"),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                persona.displayName,
                color = MaterialTheme.colorScheme.onSurface,
            )
            Text(
                persona.email,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Spacer(modifier = Modifier.width(8.dp))
        Surface(
            color =
                when (persona.cohort) {
                    DevPersona.Cohort.ADULT -> MaterialTheme.colorScheme.primaryContainer
                    DevPersona.Cohort.MINOR -> MaterialTheme.colorScheme.secondaryContainer
                },
            shape = RoundedCornerShape(8.dp),
        ) {
            Text(
                text =
                    when (persona.cohort) {
                        DevPersona.Cohort.ADULT -> "adult"
                        DevPersona.Cohort.MINOR -> "minor"
                    },
                color =
                    when (persona.cohort) {
                        DevPersona.Cohort.ADULT -> MaterialTheme.colorScheme.onPrimaryContainer
                        DevPersona.Cohort.MINOR -> MaterialTheme.colorScheme.onSecondaryContainer
                    },
                style = MaterialTheme.typography.labelSmall,
                modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
            )
        }
    }
}
