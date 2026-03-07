package com.shyden.shytalk.feature.profile

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.koin.compose.viewmodel.koinViewModel
import androidx.compose.runtime.collectAsState
import com.shyden.shytalk.core.util.formatDateForDisplay
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.*
import org.jetbrains.compose.resources.stringResource

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun ProfileSetupScreen(
    onProfileComplete: () -> Unit,
    viewModel: ProfileViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }
    var displayName by rememberSaveable { mutableStateOf("") }
    var selectedDateMillis by rememberSaveable { mutableStateOf<Long?>(null) }
    var showDatePicker by remember { mutableStateOf(false) }
    var dateError by rememberSaveable { mutableStateOf<String?>(null) }

    LaunchedEffect(uiState.profileSaved) {
        if (uiState.profileSaved) {
            onProfileComplete()
        }
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Scaffold(snackbarHost = { SnackbarHost(snackbarHostState) }) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
                .padding(horizontal = 32.dp),
            verticalArrangement = Arrangement.Center,
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                text = stringResource(Res.string.set_up_your_profile),
                style = MaterialTheme.typography.headlineMedium
            )

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = stringResource(Res.string.profile_setup_subtitle),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(32.dp))

            OutlinedTextField(
                value = displayName,
                onValueChange = { if (it.length <= 20) displayName = it },
                label = { Text(stringResource(Res.string.display_name)) },
                modifier = Modifier.fillMaxWidth().testTag("profileSetup_displayNameField"),
                singleLine = true,
                supportingText = { Text("${displayName.length}/20") }
            )

            Spacer(modifier = Modifier.height(16.dp))

            // Date of Birth picker
            OutlinedButton(
                onClick = { showDatePicker = true },
                modifier = Modifier.fillMaxWidth().testTag("profileSetup_dobButton")
            ) {
                Text(
                    text = if (selectedDateMillis != null) {
                        formatDateForDisplay(selectedDateMillis!!)
                    } else {
                        stringResource(Res.string.select_date_of_birth)
                    }
                )
            }

            if (dateError != null) {
                Spacer(modifier = Modifier.height(4.dp))
                Text(
                    text = dateError!!,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error
                )
            }

            Spacer(modifier = Modifier.height(8.dp))

            Text(
                text = stringResource(Res.string.dob_privacy_note),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )

            Spacer(modifier = Modifier.height(24.dp))

            val canContinue = displayName.isNotBlank() &&
                selectedDateMillis != null &&
                dateError == null &&
                !uiState.isLoading

            Button(
                onClick = {
                    selectedDateMillis?.let { millis ->
                        viewModel.saveProfile(displayName.trim(), millis)
                    }
                },
                enabled = canContinue,
                modifier = Modifier.fillMaxWidth().testTag("profileSetup_continueButton")
            ) {
                if (uiState.isLoading) {
                    CircularProgressIndicator(
                        color = MaterialTheme.colorScheme.onPrimary
                    )
                } else {
                    Text(stringResource(Res.string.continue_button))
                }
            }
        }
    }

    if (showDatePicker) {
        DOBDatePickerDialog(
            onDismiss = { showDatePicker = false },
            onDateSelected = { millis, error ->
                selectedDateMillis = millis
                dateError = error
            }
        )
    }
}
