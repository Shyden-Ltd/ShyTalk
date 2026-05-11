package com.shyden.shytalk.core.ui

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.additional_details_optional
import com.shyden.shytalk.resources.cancel
import com.shyden.shytalk.resources.report_message
import com.shyden.shytalk.resources.report_message_prompt
import com.shyden.shytalk.resources.submit_report
import org.jetbrains.compose.resources.stringResource

internal val reportMessageReasons = listOf("Spam", "Harassment", "Inappropriate Content", "Other")

/**
 * Shared per-message report dialog. Used by both DM (PrivateChatScreen) and
 * room (RoomScreen) surfaces — keep behaviour symmetric so a reporter who
 * uses one path and then the other doesn't see a different reason list.
 *
 * Lives in `core/ui` rather than `feature/messaging` so the `feature/room`
 * import isn't a sibling-feature dependency.
 */
@Composable
fun ReportMessageDialog(
    onDismiss: () -> Unit,
    onSubmit: (reason: String, description: String) -> Unit,
) {
    var selectedReason by remember { mutableStateOf(reportMessageReasons[0]) }
    var description by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(Res.string.report_message)) },
        text = {
            Column {
                Text(
                    text = stringResource(Res.string.report_message_prompt),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(modifier = Modifier.height(8.dp))
                reportMessageReasons.forEach { reason ->
                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .clickable { selectedReason = reason }
                                .padding(vertical = 4.dp)
                                .testTag("reportReasonRow_$reason"),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(
                            selected = selectedReason == reason,
                            onClick = { selectedReason = reason },
                            modifier = Modifier.testTag("reportReasonRadio_$reason"),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(text = reason, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    placeholder = { Text(stringResource(Res.string.additional_details_optional)) },
                    modifier = Modifier.fillMaxWidth().testTag("reportDescription"),
                    maxLines = 3,
                )
            }
        },
        confirmButton = {
            TextButton(
                onClick = { onSubmit(selectedReason, description) },
                modifier = Modifier.testTag("reportSubmit"),
            ) {
                Text(stringResource(Res.string.submit_report))
            }
        },
        dismissButton = {
            TextButton(
                onClick = onDismiss,
                modifier = Modifier.testTag("reportDismiss"),
            ) {
                Text(stringResource(Res.string.cancel))
            }
        },
    )
}
