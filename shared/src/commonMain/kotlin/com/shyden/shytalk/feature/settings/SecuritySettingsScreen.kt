package com.shyden.shytalk.feature.settings

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.ChevronRight
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.ListItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.data.repository.AppLockRepository

private val TIMEOUT_OPTIONS =
    listOf(
        1 to "1 minute",
        5 to "5 minutes",
        15 to "15 minutes",
        30 to "30 minutes",
        0 to "Never",
    )

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SecuritySettingsScreen(
    appLockRepository: AppLockRepository,
    biometricAvailable: Boolean,
    onNavigateBack: () -> Unit,
    onResetPin: () -> Unit,
    onLinkedAccounts: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var appLockEnabled by remember { mutableStateOf(appLockRepository.isAppLockEnabled) }
    var biometricEnabled by remember { mutableStateOf(appLockRepository.isBiometricEnabled) }
    var lockTimeout by remember { mutableStateOf(appLockRepository.lockTimeoutMinutes) }
    var showTimeoutMenu by remember { mutableStateOf(false) }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Security") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier =
                modifier
                    .fillMaxSize()
                    .padding(padding)
                    .verticalScroll(rememberScrollState())
                    .testTag("securitySettingsScreen"),
        ) {
            // App Lock
            ListItem(
                headlineContent = { Text("App Lock") },
                supportingContent = { Text("Require PIN or biometric to unlock") },
                trailingContent = {
                    Switch(
                        checked = appLockEnabled,
                        onCheckedChange = {
                            appLockEnabled = it
                            appLockRepository.setAppLockEnabled(it)
                        },
                    )
                },
                modifier = Modifier.testTag("appLockToggle"),
            )

            // Lock Timeout (only visible when app lock is on)
            if (appLockEnabled) {
                val timeoutLabel = TIMEOUT_OPTIONS.firstOrNull { it.first == lockTimeout }?.second ?: "5 minutes"
                ListItem(
                    headlineContent = { Text("Lock Timeout") },
                    supportingContent = { Text(timeoutLabel) },
                    trailingContent = {
                        Icon(Icons.Default.ChevronRight, contentDescription = null)
                        DropdownMenu(
                            expanded = showTimeoutMenu,
                            onDismissRequest = { showTimeoutMenu = false },
                        ) {
                            TIMEOUT_OPTIONS.forEach { (minutes, label) ->
                                DropdownMenuItem(
                                    text = { Text(label) },
                                    onClick = {
                                        lockTimeout = minutes
                                        appLockRepository.setLockTimeoutMinutes(minutes)
                                        showTimeoutMenu = false
                                    },
                                )
                            }
                        }
                    },
                    modifier =
                        Modifier
                            .clickable { showTimeoutMenu = true }
                            .testTag("lockTimeoutSetting"),
                )
            }

            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))

            // Biometric Login
            ListItem(
                headlineContent = { Text("Biometric Login") },
                supportingContent = {
                    Text(
                        if (biometricAvailable) {
                            "Use fingerprint or face to unlock"
                        } else {
                            "Not available on this device"
                        },
                    )
                },
                trailingContent = {
                    Switch(
                        checked = biometricEnabled,
                        onCheckedChange = {
                            biometricEnabled = it
                            appLockRepository.setBiometricEnabled(it)
                        },
                        enabled = biometricAvailable,
                    )
                },
                modifier = Modifier.testTag("biometricToggle"),
            )

            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))

            // Reset PIN
            ListItem(
                headlineContent = { Text("Reset PIN") },
                supportingContent = { Text("Verify your identity to set a new PIN") },
                trailingContent = {
                    Icon(Icons.Default.ChevronRight, contentDescription = null)
                },
                modifier =
                    Modifier
                        .clickable(onClick = onResetPin)
                        .testTag("resetPinSetting"),
            )

            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))

            // Linked Accounts
            ListItem(
                headlineContent = { Text("Linked Accounts") },
                supportingContent = { Text("Manage sign-in methods") },
                trailingContent = {
                    Icon(Icons.Default.ChevronRight, contentDescription = null)
                },
                modifier =
                    Modifier
                        .clickable(onClick = onLinkedAccounts)
                        .testTag("linkedAccountsSetting"),
            )
        }
    }
}
