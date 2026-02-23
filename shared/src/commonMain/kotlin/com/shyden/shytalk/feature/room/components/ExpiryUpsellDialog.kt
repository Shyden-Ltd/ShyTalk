package com.shyden.shytalk.feature.room.components

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.ui.SuperShyGold

@Composable
fun ExpiryUpsellDialog(
    isViewerSuperShy: Boolean,
    superShyDurationHours: Int,
    onDismiss: () -> Unit,
    onOpenSuperShy: () -> Unit
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                "Room Closing Soon",
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column {
                Text(
                    "The room owner doesn't have Super Shy, so this room will close soon.",
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(8.dp))
                if (isViewerSuperShy) {
                    Text(
                        "You have Super Shy! Open your own room for up to $superShyDurationHours hours of extended time.",
                        style = MaterialTheme.typography.bodyMedium,
                        color = SuperShyGold,
                        fontWeight = FontWeight.Bold
                    )
                } else {
                    Text(
                        "Get Super Shy to enjoy rooms that last up to $superShyDurationHours hours!",
                        style = MaterialTheme.typography.bodyMedium,
                        color = SuperShyGold,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        },
        confirmButton = {
            if (isViewerSuperShy) {
                TextButton(onClick = onDismiss) {
                    Text("Got it")
                }
            } else {
                TextButton(onClick = {
                    onDismiss()
                    onOpenSuperShy()
                }) {
                    Text("Learn More", color = SuperShyGold)
                }
            }
        },
        dismissButton = if (!isViewerSuperShy) {
            {
                TextButton(onClick = onDismiss) {
                    Text("Maybe Later")
                }
            }
        } else null
    )
}
