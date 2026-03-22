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
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.semantics.role
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.data.repository.AppLockRepository
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.stringResource

private val TIMEOUT_OPTIONS: List<Pair<Int, StringResource>> =
    listOf(
        1 to Res.string.security_timeout_1min,
        5 to Res.string.security_timeout_5min,
        15 to Res.string.security_timeout_15min,
        30 to Res.string.security_timeout_30min,
        0 to Res.string.security_timeout_never,
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
                title = { Text(stringResource(Res.string.security_title)) },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back))
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
                headlineContent = { Text(stringResource(Res.string.security_app_lock)) },
                supportingContent = { Text(stringResource(Res.string.security_app_lock_desc)) },
                trailingContent = {
                    Switch(
                        checked = appLockEnabled,
                        onCheckedChange = {
                            appLockEnabled = it
                            appLockRepository.setAppLockEnabled(it)
                        },
                    )
                },
                modifier =
                    Modifier
                        .clickable {
                            appLockEnabled = !appLockEnabled
                            appLockRepository.setAppLockEnabled(appLockEnabled)
                        }.testTag("appLockToggle"),
            )

            // Lock Timeout (only visible when app lock is on)
            if (appLockEnabled) {
                val timeoutLabel =
                    TIMEOUT_OPTIONS.firstOrNull { it.first == lockTimeout }?.second
                        ?: Res.string.security_timeout_5min
                ListItem(
                    headlineContent = { Text(stringResource(Res.string.security_lock_timeout)) },
                    supportingContent = { Text(stringResource(timeoutLabel)) },
                    trailingContent = {
                        Icon(Icons.Default.ChevronRight, contentDescription = null)
                        DropdownMenu(
                            expanded = showTimeoutMenu,
                            onDismissRequest = { showTimeoutMenu = false },
                        ) {
                            TIMEOUT_OPTIONS.forEach { (minutes, labelRes) ->
                                DropdownMenuItem(
                                    text = { Text(stringResource(labelRes)) },
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
                            .semantics { role = Role.Button }
                            .testTag("lockTimeoutSetting"),
                )
            }

            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))

            // Biometric Login
            ListItem(
                headlineContent = { Text(stringResource(Res.string.security_biometric_login)) },
                supportingContent = {
                    Text(
                        if (biometricAvailable) {
                            stringResource(Res.string.security_biometric_desc)
                        } else {
                            stringResource(Res.string.security_biometric_unavailable)
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
                modifier =
                    Modifier
                        .clickable(enabled = biometricAvailable) {
                            biometricEnabled = !biometricEnabled
                            appLockRepository.setBiometricEnabled(biometricEnabled)
                        }.testTag("biometricToggle"),
            )

            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))

            // Reset PIN
            ListItem(
                headlineContent = { Text(stringResource(Res.string.security_reset_pin)) },
                supportingContent = { Text(stringResource(Res.string.security_reset_pin_desc)) },
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
                headlineContent = { Text(stringResource(Res.string.security_linked_accounts)) },
                supportingContent = { Text(stringResource(Res.string.security_linked_accounts_desc)) },
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
