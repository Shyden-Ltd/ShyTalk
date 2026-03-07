package com.shyden.shytalk.feature.room.components

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Badge
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.ui.StyledDisplayName
import com.shyden.shytalk.feature.messaging.ReportUserDialog
import com.shyden.shytalk.ui.components.FlagBadge
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.*
import org.jetbrains.compose.resources.stringResource

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun UserCardPopup(
    user: User,
    isBlocked: Boolean,
    isSelf: Boolean,
    onViewProfile: () -> Unit,
    onBlock: () -> Unit,
    onUnblock: () -> Unit,
    onDismiss: () -> Unit,
    onMessage: (() -> Unit)? = null,
    onInvite: (() -> Unit)? = null,
    // Moderation actions (null = not available)
    onMuteToggle: (() -> Unit)? = null,
    isTargetMuted: Boolean = false,
    onRemoveFromSeat: (() -> Unit)? = null,
    onKickFromRoom: ((String) -> Unit)? = null,
    onMoveSeat: ((Int) -> Unit)? = null,
    emptySeats: List<Int> = emptyList(),
    seatOccupantNames: Map<Int, String> = emptyMap(),
    onMakeHost: (() -> Unit)? = null,
    onRemoveHost: (() -> Unit)? = null,
    isHost: Boolean = false,
    onSendGift: (() -> Unit)? = null,
    onReportUser: ((reason: String, description: String) -> Unit)? = null,
    evidenceItems: List<ByteArray> = emptyList(),
    onAddEvidence: (() -> Unit)? = null,
    onRemoveEvidence: ((Int) -> Unit)? = null,
    isSubmittingReport: Boolean = false,
    isCompressingEvidence: Boolean = false,
    reportError: String? = null,
    currentAlias: String? = null,
    onSetAlias: ((String) -> Unit)? = null,
    onRemoveAlias: (() -> Unit)? = null
) {
    var showBlockConfirm by remember { mutableStateOf(false) }
    var showKickConfirm by remember { mutableStateOf(false) }
    var kickReason by remember { mutableStateOf("") }
    var showMoveDialog by remember { mutableStateOf(false) }
    var showReportDialog by remember { mutableStateOf(false) }
    var showAliasDialog by remember { mutableStateOf(false) }
    var aliasText by remember { mutableStateOf(currentAlias ?: "") }

    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .verticalScroll(rememberScrollState())
                .padding(bottom = 24.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            // --- Avatar ---
            Box {
                val photoUrl = user.photoUrl
                if (photoUrl != null) {
                    AsyncImage(
                        model = photoUrl,
                        contentDescription = user.displayName,
                        modifier = Modifier
                            .size(100.dp)
                            .clip(CircleShape)
                            .border(
                                3.dp,
                                MaterialTheme.colorScheme.primary,
                                CircleShape
                            ),
                        contentScale = ContentScale.Crop
                    )
                } else {
                    Surface(
                        modifier = Modifier.size(100.dp),
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.primaryContainer
                    ) {
                        Icon(
                            Icons.Default.Person,
                            contentDescription = user.displayName,
                            modifier = Modifier.padding(20.dp),
                            tint = MaterialTheme.colorScheme.onPrimaryContainer
                        )
                    }
                }

                if (user.nationality != null) {
                    FlagBadge(
                        countryCode = user.nationality!!,
                        badgeSize = 28.dp,
                        modifier = Modifier.align(Alignment.BottomEnd)
                    )
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            // --- Name + Host badge + View Profile ---
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically
            ) {
                val resolvedName = currentAlias ?: user.displayName
                StyledDisplayName(
                    displayName = resolvedName,
                    isSuperShy = user.isSuperShy,
                    style = MaterialTheme.typography.titleMedium
                )
                if (isHost) {
                    Spacer(modifier = Modifier.width(6.dp))
                    Surface(
                        shape = RoundedCornerShape(12.dp),
                        color = MaterialTheme.colorScheme.primary,
                        contentColor = MaterialTheme.colorScheme.onPrimary
                    ) {
                        Text(
                            text = stringResource(Res.string.host),
                            style = MaterialTheme.typography.labelSmall,
                            modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp)
                        )
                    }
                }
                Spacer(modifier = Modifier.width(8.dp))
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    border = BorderStroke(1.dp, MaterialTheme.colorScheme.outline),
                    color = Color.Transparent,
                    modifier = Modifier.clickable { onViewProfile() }
                ) {
                    Text(
                        text = stringResource(Res.string.view_profile),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp)
                    )
                }
            }

            if (currentAlias != null) {
                Text(
                    text = "(${user.displayName})",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            if (user.uniqueId != 0L) {
                Spacer(modifier = Modifier.height(2.dp))
                Text(
                    text = stringResource(Res.string.user_id, user.uniqueId),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // --- Icon action buttons (non-self only) ---
            if (!isSelf) {
                val iconActions = buildList {
                    if (onMessage != null) {
                        add(IconAction(Icons.AutoMirrored.Filled.Chat, stringResource(Res.string.message), null, onMessage))
                    }
                    if (onSendGift != null) {
                        add(IconAction(Icons.Default.CardGiftcard, stringResource(Res.string.gift), null, onSendGift))
                    }
                    if (onSetAlias != null) {
                        add(IconAction(Icons.Default.Badge, stringResource(Res.string.alias), null) { showAliasDialog = true })
                    }
                    if (onMuteToggle != null && !isTargetMuted) {
                        add(IconAction(Icons.Default.MicOff, stringResource(Res.string.mute), null) {
                            onMuteToggle()
                            onDismiss()
                        })
                    }
                }

                if (iconActions.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(16.dp))
                    Row(
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(horizontal = 24.dp),
                        horizontalArrangement = Arrangement.SpaceEvenly
                    ) {
                        iconActions.forEach { action ->
                            UserCardIconButton(
                                icon = action.icon,
                                label = action.label,
                                tint = action.tint ?: MaterialTheme.colorScheme.onSurface,
                                onClick = action.onClick
                            )
                        }
                    }
                }

                // --- Full-width text action rows ---
                Spacer(modifier = Modifier.height(16.dp))
                HorizontalDivider()

                if (onInvite != null) {
                    UserCardTextRow(text = stringResource(Res.string.invite_to_mic), onClick = onInvite)
                }

                if (onMakeHost != null) {
                    UserCardTextRow(text = stringResource(Res.string.set_as_host)) {
                        onMakeHost()
                        onDismiss()
                    }
                }

                if (onRemoveHost != null) {
                    UserCardTextRow(text = stringResource(Res.string.remove_as_host)) {
                        onRemoveHost()
                        onDismiss()
                    }
                }

                if (onMoveSeat != null && emptySeats.isNotEmpty()) {
                    UserCardTextRow(text = stringResource(Res.string.move_to_seat)) { showMoveDialog = true }
                }

                if (onRemoveFromSeat != null) {
                    UserCardTextRow(text = stringResource(Res.string.move_to_audience)) {
                        onRemoveFromSeat()
                        onDismiss()
                    }
                }

                UserCardTextRow(
                    text = if (isBlocked) stringResource(Res.string.unblock) else stringResource(Res.string.block),
                    color = if (isBlocked) null else MaterialTheme.colorScheme.error
                ) {
                    if (isBlocked) onUnblock() else showBlockConfirm = true
                }

                if (onReportUser != null) {
                    UserCardTextRow(
                        text = stringResource(Res.string.report),
                        color = MaterialTheme.colorScheme.error
                    ) { showReportDialog = true }
                }

                if (onKickFromRoom != null) {
                    UserCardTextRow(
                        text = stringResource(Res.string.remove_from_room),
                        color = MaterialTheme.colorScheme.error
                    ) { showKickConfirm = true }
                }
            }
        }
    }

    // --- Sub-dialogs (unchanged) ---

    if (showBlockConfirm) {
        AlertDialog(
            onDismissRequest = { showBlockConfirm = false },
            title = { Text(stringResource(Res.string.block_user)) },
            text = { Text(stringResource(Res.string.block_user_confirm, user.displayName)) },
            confirmButton = {
                TextButton(onClick = {
                    showBlockConfirm = false
                    onBlock()
                }) {
                    Text(stringResource(Res.string.block))
                }
            },
            dismissButton = {
                TextButton(onClick = { showBlockConfirm = false }) {
                    Text(stringResource(Res.string.cancel))
                }
            }
        )
    }

    if (showKickConfirm) {
        AlertDialog(
            onDismissRequest = {
                showKickConfirm = false
                kickReason = ""
            },
            title = { Text(stringResource(Res.string.kick_user)) },
            text = {
                Column {
                    Text(stringResource(Res.string.kick_user_confirm, user.displayName))
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(
                        value = kickReason,
                        onValueChange = { kickReason = it },
                        label = { Text(stringResource(Res.string.reason_optional)) },
                        placeholder = { Text(stringResource(Res.string.no_reason_given)) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(onClick = {
                    val reason = kickReason
                    showKickConfirm = false
                    kickReason = ""
                    onKickFromRoom?.invoke(reason)
                    onDismiss()
                }) {
                    Text(stringResource(Res.string.kick), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showKickConfirm = false
                    kickReason = ""
                }) {
                    Text(stringResource(Res.string.cancel))
                }
            }
        )
    }

    if (showReportDialog && onReportUser != null) {
        ReportUserDialog(
            userName = user.displayName,
            onDismiss = {
                if (!isSubmittingReport) {
                    showReportDialog = false
                }
            },
            onSubmit = { reason, description ->
                onReportUser(reason, description)
            },
            evidenceItems = evidenceItems,
            onAddEvidence = onAddEvidence,
            onRemoveEvidence = onRemoveEvidence,
            isSubmitting = isSubmittingReport,
            isCompressing = isCompressingEvidence,
            errorMessage = reportError
        )
    }

    if (showMoveDialog) {
        AlertDialog(
            onDismissRequest = { showMoveDialog = false },
            title = { Text(stringResource(Res.string.move_to_which_seat)) },
            text = {
                Column {
                    emptySeats.forEach { targetIndex ->
                        val occupantName = seatOccupantNames[targetIndex]
                        val label = if (occupantName != null) {
                            stringResource(Res.string.seat_swap_with, targetIndex + 1, occupantName)
                        } else {
                            stringResource(Res.string.seat_number, targetIndex + 1)
                        }
                        TextButton(onClick = {
                            showMoveDialog = false
                            onMoveSeat?.invoke(targetIndex)
                            onDismiss()
                        }) {
                            Text(label)
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { showMoveDialog = false }) {
                    Text(stringResource(Res.string.cancel))
                }
            }
        )
    }

    if (showAliasDialog && onSetAlias != null) {
        AlertDialog(
            onDismissRequest = { showAliasDialog = false },
            title = { Text(stringResource(Res.string.set_alias)) },
            text = {
                Column {
                    Text(
                        text = stringResource(Res.string.set_alias_description, user.displayName),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(
                        value = aliasText,
                        onValueChange = { if (it.length <= 30) aliasText = it },
                        label = { Text(stringResource(Res.string.alias)) },
                        placeholder = { Text(user.displayName) },
                        singleLine = true,
                        modifier = Modifier.fillMaxWidth()
                    )
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        val trimmed = aliasText.trim()
                        if (trimmed.isNotEmpty()) {
                            onSetAlias(trimmed)
                        }
                        showAliasDialog = false
                    }
                ) {
                    Text(stringResource(Res.string.save))
                }
            },
            dismissButton = {
                Row {
                    if (currentAlias != null && onRemoveAlias != null) {
                        TextButton(onClick = {
                            onRemoveAlias()
                            aliasText = ""
                            showAliasDialog = false
                        }) {
                            Text(stringResource(Res.string.remove), color = MaterialTheme.colorScheme.error)
                        }
                    }
                    TextButton(onClick = { showAliasDialog = false }) {
                        Text(stringResource(Res.string.cancel))
                    }
                }
            }
        )
    }
}

// --- Private helpers ---

private data class IconAction(
    val icon: ImageVector,
    val label: String,
    val tint: Color?,
    val onClick: () -> Unit
)

@Composable
private fun UserCardIconButton(
    icon: ImageVector,
    label: String,
    tint: Color,
    onClick: () -> Unit
) {
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.clickable(onClick = onClick)
    ) {
        Surface(
            modifier = Modifier.size(56.dp),
            shape = CircleShape,
            color = Color.Transparent,
            border = BorderStroke(1.5.dp, MaterialTheme.colorScheme.outlineVariant)
        ) {
            Icon(
                icon,
                contentDescription = label,
                modifier = Modifier.padding(14.dp),
                tint = tint
            )
        }
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

@Composable
private fun UserCardTextRow(
    text: String,
    color: Color? = null,
    onClick: () -> Unit
) {
    Text(
        text = text,
        style = MaterialTheme.typography.bodyLarge,
        color = color ?: MaterialTheme.colorScheme.onSurface,
        textAlign = TextAlign.Center,
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 14.dp)
    )
    HorizontalDivider()
}
