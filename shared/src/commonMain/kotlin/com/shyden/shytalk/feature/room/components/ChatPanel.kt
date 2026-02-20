package com.shyden.shytalk.feature.room.components

import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Backpack
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.ui.theme.SpeakingGreen
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User

@Composable
fun ChatPanel(
    messages: List<Message>,
    currentUserId: String,
    currentRole: RoomRole,
    seats: Map<String, Seat>,
    userMap: Map<String, User>,
    isOwnerOrHost: Boolean = false,
    onToggleMic: (Int) -> Unit = {},
    onSendMessage: (String) -> Unit,
    onTapUser: (String) -> Unit,
    onInviteUser: (String, String) -> Unit,
    onToggleMessages: (() -> Unit)? = null,
    unreadCount: Int = 0,
    onOpenBackpack: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    val listState = rememberLazyListState()
    var messageText by rememberSaveable { mutableStateOf("") }

    val seatedUserIds = remember(seats) {
        seats.values.asSequence()
            .filter { it.state == SeatState.OCCUPIED && it.userId != null }
            .mapNotNull { it.userId }
            .toSet()
    }

    val currentSeatEntry = remember(seats, currentUserId) {
        seats.entries.find {
            it.value.isOccupiedBy(currentUserId)
        }
    }
    val isSeated = currentSeatEntry != null
    val isSelfMuted = currentSeatEntry?.value?.isMuted ?: false

    // Auto-scroll: with reverseLayout=true, index 0 is the bottom (newest message).
    // When a new message is inserted at index 0, the previous first visible shifts to
    // index 1, so use <= 1 to still count that as "at bottom".
    LaunchedEffect(messages.size) {
        if (listState.firstVisibleItemIndex <= 1) {
            listState.animateScrollToItem(0)
        }
    }

    val reversedMessages = remember(messages) { messages.asReversed() }

    val focusManager = LocalFocusManager.current

    Column(modifier = modifier) {
        LazyColumn(
            state = listState,
            reverseLayout = true,
            verticalArrangement = Arrangement.Bottom,
            modifier = Modifier
                .fillMaxWidth()
                .weight(1f)
                .padding(horizontal = 8.dp)
        ) {
            items(reversedMessages, key = { it.messageId }) { message ->
                val senderUser = userMap[message.senderId]
                val isSelf = message.senderId == currentUserId
                val isUserSeated = message.senderId in seatedUserIds
                MessageBubble(
                    message = message,
                    user = senderUser,
                    currentRole = currentRole,
                    isUserSeated = isUserSeated,
                    isSelf = isSelf,
                    onTapUser = { onTapUser(message.senderId) },
                    onInvite = { onInviteUser(message.senderId, message.senderName) }
                )
            }
        }

        // Message input
        Row(
            modifier = Modifier
                .fillMaxWidth()
                .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically
        ) {
            OutlinedTextField(
                value = messageText,
                onValueChange = { if (it.length <= 200) messageText = it },
                placeholder = { Text("Type a message...") },
                modifier = Modifier.weight(0.6f),
                singleLine = true
            )

            IconButton(
                onClick = {
                    if (messageText.isNotBlank()) {
                        onSendMessage(messageText)
                        messageText = ""
                    }
                }
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Send,
                    contentDescription = "Send",
                    tint = MaterialTheme.colorScheme.primary
                )
            }

            if (isSeated) {
                IconButton(onClick = {
                    focusManager.clearFocus()
                    currentSeatEntry?.key?.toIntOrNull()?.let { onToggleMic(it) }
                }) {
                    Icon(
                        imageVector = if (isSelfMuted) Icons.Default.MicOff else Icons.Default.Mic,
                        contentDescription = if (isSelfMuted) "Unmute" else "Mute",
                        tint = if (isSelfMuted) MaterialTheme.colorScheme.error else SpeakingGreen
                    )
                }
            }

            if (onToggleMessages != null) {
                IconButton(onClick = { focusManager.clearFocus(); onToggleMessages() }) {
                    BadgedBox(
                        badge = {
                            if (unreadCount > 0) {
                                Badge {
                                    Text(
                                        if (unreadCount > 99) "99+"
                                        else "$unreadCount"
                                    )
                                }
                            }
                        }
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.Chat,
                            contentDescription = "Messages",
                            tint = MaterialTheme.colorScheme.primary
                        )
                    }
                }
            }

            Spacer(modifier = Modifier.width(4.dp))

            if (onOpenBackpack != null) {
                val pulseTransition = rememberInfiniteTransition(label = "backpackPulse")
                val scale by pulseTransition.animateFloat(
                    initialValue = 1f,
                    targetValue = 1.15f,
                    animationSpec = infiniteRepeatable(
                        animation = tween(750)
                    ),
                    label = "backpackScale"
                )
                IconButton(
                    onClick = { focusManager.clearFocus(); onOpenBackpack() },
                    modifier = Modifier.graphicsLayer {
                        scaleX = scale
                        scaleY = scale
                    }
                ) {
                    Icon(
                        Icons.Default.Backpack,
                        contentDescription = "Backpack",
                        tint = MaterialTheme.colorScheme.primary
                    )
                }
            }
        }
    }
}
