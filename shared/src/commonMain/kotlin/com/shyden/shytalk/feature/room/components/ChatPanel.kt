package com.shyden.shytalk.feature.room.components

import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.clickable
import androidx.compose.foundation.gestures.detectTapGestures
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.filled.Backpack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.focus.onFocusChanged
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.input.pointer.pointerInput
import androidx.compose.ui.platform.LocalFocusManager
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.ui.theme.SpeakingGreen
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource

@Suppress("kotlin:S107", "kotlin:S3776")
@Composable
fun ChatPanel(
    messages: List<Message>,
    currentUserId: String,
    currentRole: RoomRole,
    seats: Map<String, Seat>,
    userMap: Map<String, User>,
    _isOwnerOrHost: Boolean = false,
    isVoiceUnavailable: Boolean = false,
    onToggleMic: (Int) -> Unit = {},
    onSendMessage: (String) -> Unit,
    onTapUser: (String) -> Unit,
    onInviteUser: (String, String) -> Unit,
    onToggleMessages: (() -> Unit)? = null,
    unreadCount: Int = 0,
    onOpenBackpack: (() -> Unit)? = null,
    editingMessageId: String? = null,
    editingMessageText: String = "",
    onStartEditMessage: (messageId: String, text: String) -> Unit = { _, _ -> },
    onEditMessage: (String) -> Unit = {},
    onCancelEdit: () -> Unit = {},
    aliases: Map<String, String> = emptyMap(),
    translations: Map<String, String> = emptyMap(),
    onTranslateMessage: (String) -> Unit = {},
    onReportMessage: (Message) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val listState = rememberLazyListState()
    val isEditing = editingMessageId != null
    var messageText by rememberSaveable { mutableStateOf("") }

    // When entering edit mode, set the input field to the message being edited
    LaunchedEffect(editingMessageId) {
        if (editingMessageId != null) {
            messageText = editingMessageText
        }
    }

    val seatedUserIds =
        remember(seats) {
            seats.values
                .asSequence()
                .filter { it.state == SeatState.OCCUPIED && it.userId != null }
                .mapNotNull { it.userId }
                .toSet()
        }

    val currentSeatEntry =
        remember(seats, currentUserId) {
            seats.entries.find {
                it.value.isOccupiedBy(currentUserId)
            }
        }
    val isSeated = currentSeatEntry != null
    val isSelfMuted = currentSeatEntry?.value?.isMuted ?: false

    // Track whether the user has scrolled away from the bottom
    var hasNewMessages by remember { mutableStateOf(false) }
    var lastSeenSize by remember { mutableIntStateOf(messages.size) }
    val coroutineScope = rememberCoroutineScope()

    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex }
            .collect { index ->
                if (index <= 2) hasNewMessages = false
            }
    }

    // Auto-scroll when new messages arrive and user is near the bottom.
    LaunchedEffect(messages.size) {
        if (messages.size <= lastSeenSize) {
            lastSeenSize = messages.size
            return@LaunchedEffect
        }
        lastSeenSize = messages.size
        if (listState.firstVisibleItemIndex <= 2) {
            listState.animateScrollToItem(0)
            hasNewMessages = false
        } else {
            hasNewMessages = true
        }
    }

    val reversedMessages = remember(messages) { messages.asReversed() }

    val focusManager = LocalFocusManager.current
    var isInputFocused by remember { mutableStateOf(false) }

    Column(modifier = modifier) {
        Box(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .weight(1f)
                    .pointerInput(Unit) { detectTapGestures { focusManager.clearFocus() } },
        ) {
            LazyColumn(
                state = listState,
                reverseLayout = true,
                verticalArrangement = Arrangement.Bottom,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .matchParentSize()
                        .padding(start = 8.dp, end = 80.dp),
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
                        onInvite = { onInviteUser(message.senderId, message.senderName) },
                        onEditMessage =
                            if (isSelf && message.type == com.shyden.shytalk.core.model.MessageType.TEXT) {
                                { onStartEditMessage(message.messageId, message.text) }
                            } else {
                                null
                            },
                        onReportMessage =
                            if (isRoomMessageReportable(isSelf = isSelf, type = message.type, senderId = message.senderId)) {
                                { onReportMessage(message) }
                            } else {
                                null
                            },
                        onTranslate =
                            if (!isSelf && message.type == com.shyden.shytalk.core.model.MessageType.TEXT) {
                                { onTranslateMessage(message.messageId) }
                            } else {
                                null
                            },
                        translatedText = translations[message.messageId],
                        aliases = aliases,
                    )
                }
            }

            // "New messages" chip when user has scrolled up
            if (hasNewMessages) {
                Surface(
                    shape = RoundedCornerShape(16.dp),
                    color = MaterialTheme.colorScheme.primaryContainer,
                    shadowElevation = 4.dp,
                    modifier =
                        Modifier
                            .align(Alignment.BottomCenter)
                            .padding(bottom = 8.dp)
                            .clickable {
                                hasNewMessages = false
                                coroutineScope.launch { listState.animateScrollToItem(0) }
                            },
                ) {
                    Text(
                        text = stringResource(Res.string.new_messages),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onPrimaryContainer,
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 6.dp),
                    )
                }
            }
        }

        // Message input
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            if (isEditing) {
                IconButton(onClick = {
                    messageText = ""
                    onCancelEdit()
                }) {
                    Icon(
                        Icons.Default.Close,
                        contentDescription = stringResource(Res.string.cancel_edit),
                        tint = MaterialTheme.colorScheme.error,
                    )
                }
            }

            OutlinedTextField(
                value = messageText,
                onValueChange = { if (it.length <= 200) messageText = it },
                placeholder = {
                    Text(
                        if (isEditing) {
                            stringResource(
                                Res.string.edit_message_placeholder,
                            )
                        } else {
                            stringResource(Res.string.message_placeholder)
                        },
                    )
                },
                modifier =
                    Modifier
                        .weight(1f)
                        .testTag("room_chatInput")
                        .onFocusChanged { isInputFocused = it.isFocused },
                maxLines = 4,
                shape = RoundedCornerShape(24.dp),
                leadingIcon =
                    if (isEditing) {
                        { Icon(Icons.Default.Edit, contentDescription = null, modifier = Modifier.size(16.dp)) }
                    } else {
                        null
                    },
            )
            if (isInputFocused || isEditing) {
                Spacer(modifier = Modifier.width(4.dp))
                IconButton(
                    onClick = {
                        if (messageText.isNotBlank()) {
                            if (isEditing) {
                                onEditMessage(messageText)
                            } else {
                                onSendMessage(messageText)
                            }
                            messageText = ""
                        }
                    },
                    enabled = messageText.isNotBlank(),
                ) {
                    Icon(
                        Icons.AutoMirrored.Filled.Send,
                        contentDescription = stringResource(Res.string.send),
                        tint =
                            if (messageText.isNotBlank()) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                    )
                }
            }

            if (isSeated) {
                IconButton(
                    onClick = {
                        focusManager.clearFocus()
                        currentSeatEntry.key.toIntOrNull()?.let { onToggleMic(it) }
                    },
                    enabled = !isVoiceUnavailable,
                    // Tagged for manual-qa-runner: j09 (host mic on/off),
                    // j10 (warning auto-mutes), j15 (MC unmutes between sets).
                    modifier = Modifier.testTag("room_micToggleButton"),
                ) {
                    Icon(
                        imageVector = if (isVoiceUnavailable || isSelfMuted) Icons.Default.MicOff else Icons.Default.Mic,
                        contentDescription =
                            if (isVoiceUnavailable) {
                                stringResource(Res.string.voice_unavailable)
                            } else if (isSelfMuted) {
                                stringResource(Res.string.unmute)
                            } else {
                                stringResource(Res.string.mute)
                            },
                        tint =
                            if (isVoiceUnavailable) {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            } else if (isSelfMuted) {
                                MaterialTheme.colorScheme.error
                            } else {
                                SpeakingGreen
                            },
                    )
                }
            }

            if (onToggleMessages != null) {
                IconButton(onClick = {
                    focusManager.clearFocus()
                    onToggleMessages()
                }) {
                    BadgedBox(
                        badge = {
                            if (unreadCount > 0) {
                                Badge {
                                    Text(
                                        if (unreadCount > 99) {
                                            "99+"
                                        } else {
                                            "$unreadCount"
                                        },
                                    )
                                }
                            }
                        },
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.Chat,
                            contentDescription = stringResource(Res.string.messages),
                            tint = MaterialTheme.colorScheme.primary,
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
                    animationSpec =
                        infiniteRepeatable(
                            animation = tween(750),
                        ),
                    label = "backpackScale",
                )
                IconButton(
                    onClick = {
                        focusManager.clearFocus()
                        onOpenBackpack()
                    },
                    modifier =
                        Modifier.graphicsLayer {
                            scaleX = scale
                            scaleY = scale
                        },
                ) {
                    Icon(
                        Icons.Default.Backpack,
                        contentDescription = stringResource(Res.string.backpack),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            }
        }
    }
}
