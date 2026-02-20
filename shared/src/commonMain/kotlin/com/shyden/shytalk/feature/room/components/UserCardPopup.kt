package com.shyden.shytalk.feature.room.components

import androidx.compose.foundation.border
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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.EventSeat
import androidx.compose.material.icons.filled.Flag
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonOff
import androidx.compose.material.icons.filled.Star
import androidx.compose.material.icons.filled.StarBorder
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.ui.StyledDisplayName
import com.shyden.shytalk.core.util.countryNameForCode
import com.shyden.shytalk.core.util.flagEmojiForCode
import com.shyden.shytalk.feature.messaging.ReportUserDialog
import com.shyden.shytalk.ui.components.FlagBadge

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
    reportError: String? = null
) {
    var showBlockConfirm by remember { mutableStateOf(false) }
    var showKickConfirm by remember { mutableStateOf(false) }
    var kickReason by remember { mutableStateOf("") }
    var showMoveDialog by remember { mutableStateOf(false) }
    var showReportDialog by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = null,
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                Box {
                    val photoUrl = user.photoUrl
                    if (photoUrl != null) {
                        AsyncImage(
                            model = photoUrl,
                            contentDescription = user.displayName,
                            modifier = Modifier
                                .size(80.dp)
                                .clip(CircleShape)
                                .border(
                                    2.dp,
                                    MaterialTheme.colorScheme.primary,
                                    CircleShape
                                ),
                            contentScale = ContentScale.Crop
                        )
                    } else {
                        Surface(
                            modifier = Modifier.size(80.dp),
                            shape = CircleShape,
                            color = MaterialTheme.colorScheme.primaryContainer
                        ) {
                            Icon(
                                Icons.Default.Person,
                                contentDescription = user.displayName,
                                modifier = Modifier.padding(16.dp),
                                tint = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        }
                    }

                    if (user.nationality != null) {
                        FlagBadge(
                            countryCode = user.nationality!!,
                            badgeSize = 24.dp,
                            modifier = Modifier.align(Alignment.BottomEnd)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(12.dp))

                StyledDisplayName(
                    displayName = user.displayName,
                    isSuperShy = user.isSuperShy,
                    style = MaterialTheme.typography.titleMedium
                )

                if (user.uniqueId != 0L) {
                    Spacer(modifier = Modifier.height(2.dp))
                    Text(
                        text = "ID: ${user.uniqueId}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                user.nationality?.let { nat ->
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = flagEmojiForCode(nat),
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = countryNameForCode(nat) ?: nat,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.spacedBy(8.dp)
                ) {
                    OutlinedButton(
                        onClick = onViewProfile,
                        modifier = Modifier.weight(1f)
                    ) {
                        Text("View Profile")
                    }
                    if (!isSelf) {
                        OutlinedButton(
                            onClick = {
                                if (isBlocked) {
                                    onUnblock()
                                } else {
                                    showBlockConfirm = true
                                }
                            },
                            modifier = Modifier.weight(1f)
                        ) {
                            Icon(
                                Icons.Default.Block,
                                contentDescription = null,
                                modifier = Modifier.size(16.dp)
                            )
                            Spacer(modifier = Modifier.width(4.dp))
                            Text(if (isBlocked) "Unblock" else "Block")
                        }
                    }
                }

                if (!isSelf && onMessage != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = onMessage,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.Chat,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Message")
                    }
                }

                if (!isSelf && onSendGift != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = onSendGift,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            Icons.Default.CardGiftcard,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Send Gift")
                    }
                }

                if (!isSelf && onReportUser != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = { showReportDialog = true },
                        modifier = Modifier.fillMaxWidth(),
                        colors = androidx.compose.material3.ButtonDefaults.outlinedButtonColors(
                            contentColor = MaterialTheme.colorScheme.error
                        )
                    ) {
                        Icon(
                            Icons.Default.Flag,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Report")
                    }
                }

                if (onInvite != null) {
                    Spacer(modifier = Modifier.height(8.dp))
                    OutlinedButton(
                        onClick = onInvite,
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            Icons.Default.Mic,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Invite to Mic")
                    }
                }

                // Moderation actions
                if ((onMuteToggle != null && !isTargetMuted) || onRemoveFromSeat != null || onMoveSeat != null || onKickFromRoom != null || onMakeHost != null || onRemoveHost != null) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "Moderation",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                }

                if (onMuteToggle != null && !isTargetMuted) {
                    OutlinedButton(
                        onClick = {
                            onMuteToggle()
                            onDismiss()
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            Icons.Default.MicOff,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Mute User")
                    }
                }

                if (onMakeHost != null) {
                    Spacer(modifier = Modifier.height(4.dp))
                    OutlinedButton(
                        onClick = {
                            onMakeHost()
                            onDismiss()
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            Icons.Default.Star,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Make Host")
                    }
                }

                if (onRemoveHost != null) {
                    Spacer(modifier = Modifier.height(4.dp))
                    OutlinedButton(
                        onClick = {
                            onRemoveHost()
                            onDismiss()
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            Icons.Default.StarBorder,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Remove Host")
                    }
                }

                if (onMoveSeat != null && emptySeats.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(4.dp))
                    OutlinedButton(
                        onClick = { showMoveDialog = true },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            Icons.Default.SwapHoriz,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Move to Seat")
                    }
                }

                if (onRemoveFromSeat != null) {
                    Spacer(modifier = Modifier.height(4.dp))
                    OutlinedButton(
                        onClick = {
                            onRemoveFromSeat()
                            onDismiss()
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            Icons.Default.EventSeat,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Move to Audience")
                    }
                }

                if (onKickFromRoom != null) {
                    Spacer(modifier = Modifier.height(4.dp))
                    OutlinedButton(
                        onClick = { showKickConfirm = true },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            Icons.Default.PersonOff,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp),
                            tint = MaterialTheme.colorScheme.error
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text("Kick from Room", color = MaterialTheme.colorScheme.error)
                    }
                }
            }
        },
        confirmButton = {},
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text("Close")
            }
        }
    )

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
}
