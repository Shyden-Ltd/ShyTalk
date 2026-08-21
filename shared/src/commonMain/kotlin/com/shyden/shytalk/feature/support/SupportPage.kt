package com.shyden.shytalk.feature.support

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.selection.selectable
import androidx.compose.foundation.selection.selectableGroup
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.semantics.Role
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.platform.PlatformMediaPicker
import com.shyden.shytalk.data.repository.AttachmentType
import com.shyden.shytalk.data.repository.SupportCategory
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.close
import com.shyden.shytalk.resources.support_attachment_add
import com.shyden.shytalk.resources.support_attachment_remove
import com.shyden.shytalk.resources.support_attachments_label
import com.shyden.shytalk.resources.support_category_account
import com.shyden.shytalk.resources.support_category_age
import com.shyden.shytalk.resources.support_category_bug
import com.shyden.shytalk.resources.support_category_label
import com.shyden.shytalk.resources.support_category_other
import com.shyden.shytalk.resources.support_category_payment
import com.shyden.shytalk.resources.support_category_safety
import com.shyden.shytalk.resources.support_form_hint
import com.shyden.shytalk.resources.support_form_send
import com.shyden.shytalk.resources.support_form_sent
import com.shyden.shytalk.resources.support_form_title
import org.jetbrains.compose.resources.stringResource

/** Test tags — the journey suite addresses these rather than the label text. */
const val TAG_SUPPORT_INPUT = "support_input"
const val TAG_SUPPORT_SEND = "support_send"
const val TAG_SUPPORT_BACK = "support_back"
const val TAG_SUPPORT_ADD_FILE = "support_addFile"
const val TAG_SUPPORT_ATTACHMENT = "support_attachment"
const val TAG_SUPPORT_CATEGORY = "support_category"

/**
 * Contacting support — SHY-0387.
 *
 * A page rather than a dialog, because the operator saw SHY-0385's dialog on a
 * device and called it "very boring and plain", and because categories and
 * attachments do not fit in an AlertDialog without becoming cramped.
 *
 * Everything SHY-0385 established survives: the message is never cleared on
 * failure, an already-open request is information rather than the person's
 * error, and the form resets on the way out so a second visit starts fresh.
 *
 * The category picker is pre-selected from where they came from
 * ([SupportSource]), so somebody who was just refused does not have to describe
 * the refusal — but they can change it, which is the part SHY-0385 could not do.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun SupportPage(
    viewModel: SupportFormViewModel,
    onBack: () -> Unit,
) {
    val state by viewModel.uiState.collectAsState()

    // Every way out resets, so the next visit is a form and not the last
    // confirmation. The ViewModel outlives this page.
    val leave = {
        viewModel.reset()
        onBack()
    }

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(Res.string.support_form_title), fontWeight = FontWeight.Bold) },
                navigationIcon = {
                    IconButton(onClick = leave, modifier = Modifier.testTag(TAG_SUPPORT_BACK)) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(Res.string.close),
                        )
                    }
                },
            )
        },
    ) { padding ->
        if (state.submitted) {
            SentConfirmation(modifier = Modifier.padding(padding), onClose = leave)
            return@Scaffold
        }

        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(16.dp)
                    .verticalScroll(rememberScrollState()),
        ) {
            Text(stringResource(Res.string.support_form_hint), style = MaterialTheme.typography.bodyMedium)
            Spacer(Modifier.height(20.dp))

            CategoryPicker(
                selected = state.category,
                enabled = !state.isSubmitting,
                onSelect = viewModel::selectCategory,
            )
            Spacer(Modifier.height(20.dp))

            OutlinedTextField(
                value = state.message,
                onValueChange = viewModel::updateMessage,
                enabled = !state.isSubmitting,
                // An open request is not a mistake they made, so the field is not
                // marked wrong for it.
                isError = state.error != null && !state.alreadyHasOpenTicket,
                minLines = 5,
                modifier = Modifier.fillMaxWidth().testTag(TAG_SUPPORT_INPUT),
            )
            Spacer(Modifier.height(20.dp))

            Attachments(
                attachments = state.attachments,
                isAttaching = state.isAttaching,
                enabled = !state.isSubmitting,
                onPicked = viewModel::attach,
                onUnsupported = viewModel::refuseAttachmentType,
                onRemove = viewModel::removeAttachment,
            )

            state.error?.let { error ->
                Spacer(Modifier.height(12.dp))
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

            Spacer(Modifier.height(24.dp))
            Button(
                onClick = viewModel::submit,
                // Sending again while a request is already open can only earn the
                // same refusal; editing the message clears the flag.
                enabled = !state.isSubmitting && !state.alreadyHasOpenTicket,
                modifier = Modifier.fillMaxWidth().testTag(TAG_SUPPORT_SEND),
            ) {
                if (state.isSubmitting) {
                    CircularProgressIndicator(modifier = Modifier.height(18.dp))
                } else {
                    Text(stringResource(Res.string.support_form_send))
                }
            }
            Spacer(Modifier.height(24.dp))
        }
    }
}

@Composable
private fun SentConfirmation(
    modifier: Modifier,
    onClose: () -> Unit,
) {
    Column(
        modifier = modifier.fillMaxSize().padding(24.dp),
        verticalArrangement = Arrangement.Center,
        horizontalAlignment = Alignment.CenterHorizontally,
    ) {
        Text(stringResource(Res.string.support_form_sent), style = MaterialTheme.typography.bodyLarge)
        Spacer(Modifier.height(24.dp))
        Button(onClick = onClose, modifier = Modifier.testTag(TAG_SUPPORT_BACK)) {
            Text(stringResource(Res.string.close))
        }
    }
}

@Composable
private fun CategoryPicker(
    selected: SupportCategory,
    enabled: Boolean,
    onSelect: (SupportCategory) -> Unit,
) {
    Text(stringResource(Res.string.support_category_label), style = MaterialTheme.typography.titleSmall)
    Spacer(Modifier.height(8.dp))
    Column(Modifier.selectableGroup()) {
        // Declaration order IS the order offered — the operator's approved set,
        // with the honest catch-all last.
        for (category in SupportCategory.entries) {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .selectable(
                            selected = category == selected,
                            enabled = enabled,
                            role = Role.RadioButton,
                            onClick = { onSelect(category) },
                        ).testTag("$TAG_SUPPORT_CATEGORY${category.wireValue}"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                RadioButton(selected = category == selected, onClick = null, enabled = enabled)
                Spacer(Modifier.height(0.dp))
                Text(supportCategoryLabel(category), style = MaterialTheme.typography.bodyMedium)
            }
        }
    }
}

@Composable
private fun Attachments(
    attachments: List<PendingAttachment>,
    isAttaching: Boolean,
    enabled: Boolean,
    onPicked: (String, AttachmentType, ByteArray) -> Unit,
    onUnsupported: () -> Unit,
    onRemove: (String) -> Unit,
) {
    Text(stringResource(Res.string.support_attachments_label), style = MaterialTheme.typography.titleSmall)
    Spacer(Modifier.height(8.dp))

    for (attachment in attachments) {
        Row(
            modifier = Modifier.fillMaxWidth().testTag(TAG_SUPPORT_ATTACHMENT),
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.SpaceBetween,
        ) {
            Text(attachment.displayName, style = MaterialTheme.typography.bodySmall)
            IconButton(onClick = { onRemove(attachment.r2Key) }, enabled = enabled) {
                Icon(Icons.Filled.Close, contentDescription = stringResource(Res.string.support_attachment_remove))
            }
        }
    }

    PlatformMediaPicker(
        maxCount = MAX_ATTACHMENTS,
        onMediaSelected = { picked ->
            for (media in picked) {
                // Refused HERE rather than after the bytes have gone. The picker
                // can hand back a type the server will not take.
                val type = AttachmentType.fromContentType(media.contentType)
                if (type == null) onUnsupported() else onPicked(media.displayName, type, media.bytes)
            }
        },
    ) { launchPicker ->
        OutlinedButton(
            onClick = launchPicker,
            enabled = enabled && !isAttaching && attachments.size < MAX_ATTACHMENTS,
            modifier = Modifier.testTag(TAG_SUPPORT_ADD_FILE),
        ) {
            if (isAttaching) {
                CircularProgressIndicator(modifier = Modifier.height(16.dp))
            } else {
                Icon(Icons.Filled.Add, contentDescription = null)
                Text(stringResource(Res.string.support_attachment_add))
            }
        }
    }
}

/**
 * The label for a category, from resources.
 *
 * Never the enum name: that is the bug SHY-0390 records, where a sibling report
 * dialog rendered its reasons as raw English for every reader.
 */
@Composable
private fun supportCategoryLabel(category: SupportCategory): String =
    when (category) {
        SupportCategory.Account -> stringResource(Res.string.support_category_account)
        SupportCategory.Age -> stringResource(Res.string.support_category_age)
        SupportCategory.Payment -> stringResource(Res.string.support_category_payment)
        SupportCategory.Safety -> stringResource(Res.string.support_category_safety)
        SupportCategory.Bug -> stringResource(Res.string.support_category_bug)
        SupportCategory.Other -> stringResource(Res.string.support_category_other)
    }
