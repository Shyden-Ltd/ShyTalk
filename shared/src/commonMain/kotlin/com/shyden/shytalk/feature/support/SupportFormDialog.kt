package com.shyden.shytalk.feature.support

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.close
import com.shyden.shytalk.resources.support_form_hint
import com.shyden.shytalk.resources.support_form_send
import com.shyden.shytalk.resources.support_form_sent
import com.shyden.shytalk.resources.support_form_title
import org.jetbrains.compose.resources.stringResource

/** Test tags — the journey suite addresses these rather than the label text. */
const val TAG_SUPPORT_FORM_INPUT = "supportForm_input"
const val TAG_SUPPORT_FORM_SEND = "supportForm_send"
const val TAG_SUPPORT_FORM_CLOSE = "supportForm_close"

/**
 * The in-app support form — SHY-0385.
 *
 * There is deliberately no category picker. The app already knows why somebody
 * is here: the age dialog means `Age`, Settings means `Other`. Asking a person
 * who is already frustrated to categorise their own problem is asking them to do
 * the triage, so the entry point supplies it instead.
 *
 * The message is never cleared on failure. Somebody raising a support ticket is
 * already having a bad time; losing what they wrote to a dropped connection is
 * the worst thing this screen can do, so a retry costs them nothing.
 */
@Composable
fun SupportFormDialog(
    viewModel: SupportFormViewModel,
    onDismiss: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()

    // Every way out of this dialog goes through here. The ViewModel outlives the
    // dialog — it is scoped to the screen — so leaving it holding `submitted` is
    // what made a second visit show the confirmation instead of a form.
    val dismiss = {
        viewModel.reset()
        onDismiss()
    }

    if (state.submitted) {
        AlertDialog(
            onDismissRequest = dismiss,
            title = {
                Text(stringResource(Res.string.support_form_title), fontWeight = FontWeight.Bold)
            },
            text = { Text(stringResource(Res.string.support_form_sent)) },
            confirmButton = {
                TextButton(
                    onClick = dismiss,
                    modifier = Modifier.testTag(TAG_SUPPORT_FORM_CLOSE),
                ) {
                    Text(stringResource(Res.string.close))
                }
            },
        )
        return
    }

    AlertDialog(
        // Dismissing mid-typing is allowed, but only while nothing is in flight —
        // closing during a send would leave the person unsure whether it went.
        onDismissRequest = { if (!state.isSubmitting) dismiss() },
        title = {
            Text(stringResource(Res.string.support_form_title), fontWeight = FontWeight.Bold)
        },
        text = {
            Column(modifier = Modifier.fillMaxWidth()) {
                Text(
                    stringResource(Res.string.support_form_hint),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(modifier = Modifier.height(12.dp))
                OutlinedTextField(
                    value = state.message,
                    onValueChange = viewModel::updateMessage,
                    enabled = !state.isSubmitting,
                    // An open request is not a mistake they made, so the field is
                    // not marked wrong for it.
                    isError = state.error != null && !state.alreadyHasOpenTicket,
                    minLines = 4,
                    modifier = Modifier.fillMaxWidth().testTag(TAG_SUPPORT_FORM_INPUT),
                )
                state.error?.let { error ->
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        error.resolve(),
                        color =
                            if (state.alreadyHasOpenTicket) {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            } else {
                                MaterialTheme.colorScheme.error
                            },
                        style = MaterialTheme.typography.bodySmall,
                    )
                }
            }
        },
        confirmButton = {
            TextButton(
                onClick = viewModel::submit,
                // Sending again while a request is already open can only earn the
                // same refusal. Editing the message clears the flag and re-enables
                // this, which is the one action that can change the answer.
                enabled = !state.isSubmitting && !state.alreadyHasOpenTicket,
                modifier = Modifier.testTag(TAG_SUPPORT_FORM_SEND),
            ) {
                if (state.isSubmitting) {
                    CircularProgressIndicator(modifier = Modifier.height(16.dp))
                } else {
                    Text(stringResource(Res.string.support_form_send))
                }
            }
        },
        dismissButton = {
            TextButton(
                onClick = dismiss,
                enabled = !state.isSubmitting,
                modifier = Modifier.testTag(TAG_SUPPORT_FORM_CLOSE),
            ) {
                Text(stringResource(Res.string.close))
            }
        },
    )
}
