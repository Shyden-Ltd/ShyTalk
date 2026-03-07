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
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.*
import org.jetbrains.compose.resources.stringResource

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
                stringResource(Res.string.room_closing_soon),
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column {
                Text(
                    stringResource(Res.string.room_closing_no_super_shy),
                    style = MaterialTheme.typography.bodyMedium
                )
                Spacer(modifier = Modifier.height(8.dp))
                if (isViewerSuperShy) {
                    Text(
                        stringResource(Res.string.you_have_super_shy_room, superShyDurationHours),
                        style = MaterialTheme.typography.bodyMedium,
                        color = SuperShyGold,
                        fontWeight = FontWeight.Bold
                    )
                } else {
                    Text(
                        stringResource(Res.string.get_super_shy_rooms, superShyDurationHours),
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
                    Text(stringResource(Res.string.got_it))
                }
            } else {
                TextButton(onClick = {
                    onDismiss()
                    onOpenSuperShy()
                }) {
                    Text(stringResource(Res.string.learn_more), color = SuperShyGold)
                }
            }
        },
        dismissButton = if (!isViewerSuperShy) {
            {
                TextButton(onClick = onDismiss) {
                    Text(stringResource(Res.string.maybe_later))
                }
            }
        } else null
    )
}
