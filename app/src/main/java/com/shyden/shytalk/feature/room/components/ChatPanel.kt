package com.shyden.shytalk.feature.room.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp
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
    onToggleMic: (Int) -> Unit = {},
    onSendMessage: (String) -> Unit,
    onTapUser: (String) -> Unit,
    onInviteUser: (String, String) -> Unit,
    modifier: Modifier = Modifier
) {
    val listState = rememberLazyListState()
    var messageText by remember { mutableStateOf("") }

    val seatedUserIds = remember(seats) {
        seats.values
            .filter { it.state == SeatState.OCCUPIED && it.userId != null }
            .mapNotNull { it.userId }
            .toSet()
    }

    val currentSeatEntry = seats.entries.find {
        it.value.userId == currentUserId && it.value.state == SeatState.OCCUPIED
    }
    val isSeated = currentSeatEntry != null
    val isSelfMuted = currentSeatEntry?.value?.isMuted ?: false

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
            items(messages.reversed(), key = { it.messageId }) { message ->
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
                onValueChange = { messageText = it },
                placeholder = { Text("Type a message...") },
                modifier = Modifier.weight(1f),
                singleLine = true
            )

            if (isSeated) {
                IconButton(onClick = {
                    currentSeatEntry?.key?.toIntOrNull()?.let { onToggleMic(it) }
                }) {
                    Icon(
                        imageVector = if (isSelfMuted) Icons.Default.MicOff else Icons.Default.Mic,
                        contentDescription = if (isSelfMuted) "Unmute" else "Mute",
                        tint = if (isSelfMuted) MaterialTheme.colorScheme.error else Color(0xFF4CAF50)
                    )
                }
            }

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
        }
    }
}
