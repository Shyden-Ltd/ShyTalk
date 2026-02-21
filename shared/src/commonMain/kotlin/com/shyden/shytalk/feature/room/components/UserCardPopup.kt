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
                            text = "Host",
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
                        text = "View Profile",
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
                    text = "ID: ${user.uniqueId}",
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }

            // --- Icon action buttons (non-self only) ---
            if (!isSelf) {
                val iconActions = buildList {
                    if (onMessage != null) {
                        add(IconAction(Icons.AutoMirrored.Filled.Chat, "Message", null, onMessage))
                    }
                    if (onSendGift != null) {
                        add(IconAction(Icons.Default.CardGiftcard, "Gift", null, onSendGift))
                    }
                    if (onSetAlias != null) {
                        add(IconAction(Icons.Default.Badge, "Alias", null) { showAliasDialog = true })
                    }
                    if (onMuteToggle != null && !isTargetMuted) {
                        add(IconAction(Icons.Default.MicOff, "Mute", null) {
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
                    UserCardTextRow(text = "Invite to Mic", onClick = onInvite)
                }

                if (onMakeHost != null) {
                    UserCardTextRow(text = "Set as Host") {
                        onMakeHost()
                        onDismiss()
                    }
                }

                if (onRemoveHost != null) {
                    UserCardTextRow(text = "Remove as Host") {
                        onRemoveHost()
                        onDismiss()
                    }
                }

                if (onMoveSeat != null && emptySeats.isNotEmpty()) {
                    UserCardTextRow(text = "Move to Seat") { showMoveDialog = true }
                }

                if (onRemoveFromSeat != null) {
                    UserCardTextRow(text = "Move to Audience") {
                        onRemoveFromSeat()
                        onDismiss()
                    }
                }

                UserCardTextRow(
                    text = if (isBlocked) "Unblock" else "Block",
                    color = if (isBlocked) null else MaterialTheme.colorScheme.error
                ) {
                    if (isBlocked) onUnblock() else showBlockConfirm = true
                }

                if (onReportUser != null) {
                    UserCardTextRow(
                        text = "Report",
                        color = MaterialTheme.colorScheme.error
                    ) { showReportDialog = true }
                }

                if (onKickFromRoom != null) {
                    UserCardTextRow(
                        text = "Remove from Room",
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
            title = { Text("Block User") },
            text = { Text("Are you sure you want to block ${user.displayName}?") },
            confirmButton = {
                TextButton(onClick = {
                    showBlockConfirm = false
                    onBlock()
                }) {
                    Text("Block")
                }
            },
            dismissButton = {
                TextButton(onClick = { showBlockConfirm = false }) {
                    Text("Cancel")
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
            title = { Text("Kick User") },
            text = {
                Column {
                    Text("Are you sure you want to kick ${user.displayName} from the room? They will not be able to rejoin.")
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(
                        value = kickReason,
                        onValueChange = { kickReason = it },
                        label = { Text("Reason (optional)") },
                        placeholder = { Text("No reason given") },
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
                    Text("Kick", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = {
                    showKickConfirm = false
                    kickReason = ""
                }) {
                    Text("Cancel")
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
            title = { Text("Move to which seat?") },
            text = {
                Column {
                    emptySeats.forEach { targetIndex ->
                        val occupantName = seatOccupantNames[targetIndex]
                        val label = if (occupantName != null) {
                            "Seat ${targetIndex + 1} (swap with $occupantName)"
                        } else {
                            "Seat ${targetIndex + 1}"
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
                    Text("Cancel")
                }
            }
        )
    }

    if (showAliasDialog && onSetAlias != null) {
        AlertDialog(
            onDismissRequest = { showAliasDialog = false },
            title = { Text("Set Alias") },
            text = {
                Column {
                    Text(
                        text = "Set a personal alias for ${user.displayName}. Only you will see this.",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(12.dp))
                    OutlinedTextField(
                        value = aliasText,
                        onValueChange = { if (it.length <= 30) aliasText = it },
                        label = { Text("Alias") },
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
                    Text("Save")
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
                            Text("Remove", color = MaterialTheme.colorScheme.error)
                        }
                    }
                    TextButton(onClick = { showAliasDialog = false }) {
                        Text("Cancel")
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
