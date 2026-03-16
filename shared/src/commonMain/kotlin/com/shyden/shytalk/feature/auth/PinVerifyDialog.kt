package com.shyden.shytalk.feature.auth

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.data.repository.AppLockRepository
import com.shyden.shytalk.data.repository.PinRepository
import com.shyden.shytalk.feature.auth.components.PinDots
import com.shyden.shytalk.feature.auth.components.PinKeypad
import kotlinx.coroutines.launch

/**
 * Reusable PIN verification dialog for sensitive actions.
 * Shown before: change email/link provider, delete account, view/export data.
 * Works regardless of app lock setting.
 */
@Composable
fun PinVerifyDialog(
    pinRepository: PinRepository,
    appLockRepository: AppLockRepository,
    onVerified: () -> Unit,
    onDismiss: () -> Unit,
    title: String = "Verify your identity",
    subtitle: String = "Enter your PIN to continue",
) {
    var pinInput by remember { mutableStateOf("") }
    var error by remember { mutableStateOf<String?>(null) }
    var isLoading by remember { mutableStateOf(false) }
    val scope = rememberCoroutineScope()

    val uniqueId = appLockRepository.storedUniqueId
    val deviceId = appLockRepository.storedDeviceId
    if (uniqueId == null || deviceId == null) {
        // Session corrupt — dismiss dialog and let caller handle
        onDismiss()
        return
    }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(title) },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                Spacer(Modifier.height(16.dp))

                PinDots(length = pinInput.length, maxLength = 8)

                Spacer(Modifier.height(8.dp))

                if (error != null) {
                    Text(
                        text = error!!,
                        color = MaterialTheme.colorScheme.error,
                        style = MaterialTheme.typography.bodySmall,
                    )
                    Spacer(Modifier.height(8.dp))
                }

                PinKeypad(
                    onDigit = { digit ->
                        if (pinInput.length < 8) {
                            pinInput += digit
                            error = null
                        }
                    },
                    onBackspace = {
                        if (pinInput.isNotEmpty()) pinInput = pinInput.dropLast(1)
                    },
                    onBiometric = null,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = {
                    if (pinInput.length < 4) {
                        error = "PIN too short"
                        return@TextButton
                    }
                    isLoading = true
                    scope.launch {
                        pinRepository
                            .verifyPin(uniqueId, deviceId, pinInput)
                            .onSuccess { result ->
                                isLoading = false
                                if (result.customToken != null) {
                                    onVerified()
                                } else if (result.locked) {
                                    error = "Account locked"
                                    pinInput = ""
                                } else {
                                    error = "Wrong PIN. ${result.attemptsRemaining} attempts remaining."
                                    pinInput = ""
                                }
                            }.onFailure {
                                isLoading = false
                                error = "Verification failed"
                                pinInput = ""
                            }
                    }
                },
                enabled = !isLoading && pinInput.length >= 4,
            ) {
                Text(if (isLoading) "Verifying..." else "Confirm")
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Cancel")
            }
        },
    )
}
