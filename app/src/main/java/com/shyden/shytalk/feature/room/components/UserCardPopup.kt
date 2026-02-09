package com.shyden.shytalk.feature.room.components

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
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
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.EventSeat
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonOff
import androidx.compose.material.icons.filled.SwapHoriz
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
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
import coil.compose.AsyncImage
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.countryNameForCode
import com.shyden.shytalk.core.util.flagEmojiForCode

@Composable
fun UserCardPopup(
    user: User,
    isBlocked: Boolean,
    isSelf: Boolean,
    onViewProfile: () -> Unit,
    onBlock: () -> Unit,
    onUnblock: () -> Unit,
    onDismiss: () -> Unit,
    onInvite: (() -> Unit)? = null,
    // Moderation actions (null = not available)
    onMuteToggle: (() -> Unit)? = null,
    isTargetMuted: Boolean = false,
    onRemoveFromSeat: (() -> Unit)? = null,
    onKickFromRoom: (() -> Unit)? = null,
    onMoveSeat: ((Int) -> Unit)? = null,
    emptySeats: List<Int> = emptyList()
) {
    var showBlockConfirm by remember { mutableStateOf(false) }
    var showKickConfirm by remember { mutableStateOf(false) }
    var showMoveDialog by remember { mutableStateOf(false) }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = null,
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                val photoUrl = user.profilePhotoUrl ?: user.avatarUrl
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

                Spacer(modifier = Modifier.height(12.dp))

                Text(
                    text = user.displayName,
                    style = MaterialTheme.typography.titleMedium
                )

                if (user.nationality != null) {
                    Spacer(modifier = Modifier.height(4.dp))
                    Row(verticalAlignment = Alignment.CenterVertically) {
                        Text(
                            text = flagEmojiForCode(user.nationality),
                            style = MaterialTheme.typography.bodyMedium
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(
                            text = countryNameForCode(user.nationality) ?: user.nationality,
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
                if (onMuteToggle != null || onRemoveFromSeat != null || onMoveSeat != null || onKickFromRoom != null) {
                    Spacer(modifier = Modifier.height(12.dp))
                    Text(
                        text = "Moderation",
                        style = MaterialTheme.typography.labelMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(4.dp))
                }

                if (onMuteToggle != null) {
                    OutlinedButton(
                        onClick = {
                            onMuteToggle()
                            onDismiss()
                        },
                        modifier = Modifier.fillMaxWidth()
                    ) {
                        Icon(
                            if (isTargetMuted) Icons.Default.Mic else Icons.Default.MicOff,
                            contentDescription = null,
                            modifier = Modifier.size(16.dp)
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        Text(if (isTargetMuted) "Unmute User" else "Mute User")
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
                        Text("Remove from Seat")
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
            onDismissRequest = { showKickConfirm = false },
            title = { Text("Kick User") },
            text = { Text("Are you sure you want to kick ${user.displayName} from the room? They will not be able to rejoin.") },
            confirmButton = {
                TextButton(onClick = {
                    showKickConfirm = false
                    onKickFromRoom?.invoke()
                    onDismiss()
                }) {
                    Text("Kick", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showKickConfirm = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    if (showMoveDialog) {
        AlertDialog(
            onDismissRequest = { showMoveDialog = false },
            title = { Text("Move to which seat?") },
            text = {
                Column {
                    emptySeats.forEach { targetIndex ->
                        TextButton(onClick = {
                            showMoveDialog = false
                            onMoveSeat?.invoke(targetIndex)
                            onDismiss()
                        }) {
                            Text("Seat ${targetIndex + 1}")
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
