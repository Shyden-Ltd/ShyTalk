package com.shyden.shytalk.feature.messaging

import androidx.compose.foundation.background
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
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
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Done
import androidx.compose.material.icons.filled.DoneAll
import androidx.compose.material.icons.filled.ErrorOutline
import androidx.compose.material.icons.filled.Person
import androidx.compose.ui.graphics.Brush
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalClipboardManager
import androidx.compose.ui.text.AnnotatedString
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.PrivateMessage
import com.shyden.shytalk.core.model.PrivateMessageType
import com.shyden.shytalk.core.model.SendStatus
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.formatRelativeTime

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun PrivateMessageBubble(
    message: PrivateMessage,
    isSent: Boolean,
    isRead: Boolean,
    showTimestamp: Boolean,
    otherUserId: String,
    currentUserId: String = "",
    onEdit: () -> Unit,
    onReply: () -> Unit,
    onViewEditHistory: () -> Unit,
    onRetry: () -> Unit,
    onReportMessage: () -> Unit,
    onToggleReaction: (String) -> Unit = {},
    onTapReplyPreview: (() -> Unit)? = null,
    onImageClick: ((List<String>, Int) -> Unit)? = null,
    onRoomInviteTap: ((String) -> Unit)? = null,
    onRecall: () -> Unit = {},
    onSaveSticker: ((String) -> Unit)? = null,
    onHideMessage: (() -> Unit)? = null,
    isModOrAbove: Boolean = false,
    isGroupChat: Boolean = false,
    modifier: Modifier = Modifier
) {
    // System/mod messages: render as centered, non-interactive text
    val isSystemMessage = message.type == PrivateMessageType.MOD_ACTION || message.type == PrivateMessageType.SYSTEM
    if (isSystemMessage) {
        Box(
            modifier = modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp),
            contentAlignment = Alignment.Center
        ) {
            Text(
                text = message.text,
                style = MaterialTheme.typography.bodySmall,
                fontStyle = FontStyle.Italic,
                color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f)
            )
        }
        return
    }

    // Hidden message replacement
    if (message.isHidden) {
        Row(
            modifier = modifier
                .fillMaxWidth()
                .padding(horizontal = 8.dp, vertical = 2.dp),
            horizontalArrangement = if (isSent) Arrangement.End else Arrangement.Start
        ) {
            Surface(
                shape = RoundedCornerShape(16.dp),
                color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.5f),
                modifier = Modifier.widthIn(max = 280.dp)
            ) {
                Text(
                    text = "This message was hidden by a moderator",
                    style = MaterialTheme.typography.bodySmall,
                    fontStyle = FontStyle.Italic,
                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                    modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                )
            }
        }
        return
    }

    @Suppress("DEPRECATION")
    val clipboardManager = LocalClipboardManager.current
    var showContextMenu by remember { mutableStateOf(false) }
    var showReactionPicker by remember { mutableStateOf(false) }

    val canEdit = isSent &&
        message.sendStatus == SendStatus.SENT &&
        !message.isRecalled &&
        (currentTimeMillis() - message.createdAt) < Constants.PM_EDIT_WINDOW_MS

    val canRecall = isSent && !message.isRecalled &&
        message.sendStatus == SendStatus.SENT &&
        (currentTimeMillis() - message.createdAt) < Constants.PM_RECALL_WINDOW_MS

    val isMediaOnly = !message.isRecalled && (
        (message.type == PrivateMessageType.STICKER && !message.stickerUrl.isNullOrEmpty()) ||
        (message.type == PrivateMessageType.IMAGE && (message.imageUrls.isNotEmpty() || message.localImageData.isNotEmpty()) && message.text.isBlank()) ||
        (message.type == PrivateMessageType.ROOM_INVITE && !message.roomInviteId.isNullOrEmpty())
    )

    val isSending = message.sendStatus == SendStatus.SENDING
    val contentAlpha = if (isSending) 0.7f else 1f

    // Colors for bottom row — use onSurface for media-only (no bubble), otherwise bubble text color
    val metaColor = if (isMediaOnly) {
        MaterialTheme.colorScheme.onSurface.copy(alpha = 0.6f)
    } else if (isSent) {
        MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.6f)
    } else {
        MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
    }

    Row(
        modifier = modifier
            .fillMaxWidth()
            .padding(horizontal = 8.dp, vertical = 2.dp),
        horizontalArrangement = if (isSent) Arrangement.End else Arrangement.Start,
        verticalAlignment = Alignment.Bottom
    ) {
        // Failed message retry icon
        if (isSent && message.sendStatus == SendStatus.FAILED) {
            IconButton(
                onClick = onRetry,
                modifier = Modifier.size(24.dp)
            ) {
                Icon(
                    Icons.Default.ErrorOutline,
                    contentDescription = "Retry",
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(20.dp)
                )
            }
            Spacer(modifier = Modifier.width(4.dp))
        }

        Column {
            Column(
                modifier = Modifier
                    .widthIn(max = 280.dp)
                    .then(
                        if (isMediaOnly) Modifier else Modifier.clip(
                            RoundedCornerShape(
                                topStart = 16.dp,
                                topEnd = 16.dp,
                                bottomStart = if (isSent) 16.dp else 4.dp,
                                bottomEnd = if (isSent) 4.dp else 16.dp
                            )
                        )
                    )
                    .then(
                        if (isMediaOnly) Modifier else Modifier.background(
                            if (isSent) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.surfaceVariant
                        )
                    )
                    .combinedClickable(
                        onClick = { showContextMenu = true },
                        onLongClick = { showContextMenu = true }
                    )
                    .then(
                        if (isMediaOnly) Modifier.padding(4.dp)
                        else Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                    )
                    .alpha(contentAlpha)
            ) {
                // Recalled message
                if (message.isRecalled) {
                    Text(
                        text = if (isSent) "You recalled this message" else "This message was recalled",
                        style = MaterialTheme.typography.bodyMedium,
                        fontStyle = FontStyle.Italic,
                        color = if (isMediaOnly) MaterialTheme.colorScheme.onSurface.copy(alpha = 0.5f)
                            else if (isSent) MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.5f)
                            else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                    )
                } else {
                    // Reply preview
                    if (message.replyToMessageId != null && message.replyToSenderName != null) {
                        Box(
                            modifier = Modifier
                                .fillMaxWidth()
                                .clip(RoundedCornerShape(8.dp))
                                .background(
                                    if (isSent) MaterialTheme.colorScheme.primary.copy(alpha = 0.7f)
                                    else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.7f)
                                )
                                .then(
                                    if (onTapReplyPreview != null) Modifier.clickable { onTapReplyPreview() }
                                    else Modifier
                                )
                                .padding(8.dp)
                        ) {
                            Column {
                                Text(
                                    text = message.replyToSenderName!!,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = if (isSent) MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.8f)
                                    else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.8f),
                                    maxLines = 1
                                )
                                Text(
                                    text = message.replyToText ?: "",
                                    style = MaterialTheme.typography.bodySmall,
                                    color = if (isSent) MaterialTheme.colorScheme.onPrimary.copy(alpha = 0.6f)
                                    else MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f),
                                    maxLines = 2,
                                    overflow = TextOverflow.Ellipsis
                                )
                            }
                        }
                        Spacer(modifier = Modifier.height(4.dp))
                    }

                    // Sticker
                    if (message.type == PrivateMessageType.STICKER && !message.stickerUrl.isNullOrEmpty()) {
                        AsyncImage(
                            model = message.stickerUrl,
                            contentDescription = "Sticker",
                            modifier = Modifier
                                .size(120.dp)
                                .clip(RoundedCornerShape(8.dp)),
                            contentScale = ContentScale.Fit
                        )
                    }

                    // Room invite card — styled like RoomListItem
                    if (message.type == PrivateMessageType.ROOM_INVITE && !message.roomInviteId.isNullOrEmpty()) {
                        Box(
                            modifier = Modifier
                                .widthIn(min = 220.dp, max = 280.dp)
                                .height(100.dp)
                                .clip(RoundedCornerShape(12.dp))
                                .background(MaterialTheme.colorScheme.primaryContainer)
                                .clickable { onRoomInviteTap?.invoke(message.roomInviteId!!) }
                        ) {
                            // Gradient overlay
                            Box(
                                modifier = Modifier
                                    .matchParentSize()
                                    .background(
                                        Brush.verticalGradient(
                                            colors = listOf(Color.Transparent, Color.Black.copy(alpha = 0.7f)),
                                            startY = 30f
                                        )
                                    )
                            )
                            // Room info
                            Column(
                                modifier = Modifier
                                    .matchParentSize()
                                    .padding(12.dp),
                                verticalArrangement = Arrangement.Bottom
                            ) {
                                Text(
                                    text = message.roomInviteName ?: "Room",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = Color.White,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis
                                )
                                Spacer(modifier = Modifier.height(2.dp))
                                Text(
                                    text = "Tap to join",
                                    style = MaterialTheme.typography.labelMedium,
                                    color = Color.White.copy(alpha = 0.8f)
                                )
                            }
                            // Person icon at top-right
                            Icon(
                                Icons.Default.Person,
                                contentDescription = null,
                                modifier = Modifier
                                    .align(Alignment.TopEnd)
                                    .padding(8.dp)
                                    .size(24.dp),
                                tint = MaterialTheme.colorScheme.onPrimaryContainer
                            )
                        }
                    }

                    // Image grid — local preview or remote URLs
                    if (message.type == PrivateMessageType.IMAGE) {
                        if (message.localImageData.isNotEmpty() && message.imageUrls.isEmpty()) {
                            // Optimistic local preview
                            LocalImageGrid(
                                localImageData = message.localImageData,
                                onLongClick = { showContextMenu = true }
                            )
                        } else if (message.imageUrls.isNotEmpty()) {
                            ImageGrid(
                                imageUrls = message.imageUrls,
                                onImageClick = onImageClick,
                                onLongClick = { showContextMenu = true }
                            )
                        }
                        if (message.text.isNotBlank()) {
                            Spacer(modifier = Modifier.height(4.dp))
                        }
                    }

                    // Text content
                    if (message.text.isNotBlank()) {
                        Text(
                            text = message.text,
                            style = MaterialTheme.typography.bodyMedium,
                            color = if (isSent) MaterialTheme.colorScheme.onPrimary
                            else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }

                // Bottom row: edited indicator + timestamp + read receipt / sending indicator
                Row(
                    modifier = Modifier.align(Alignment.End),
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.spacedBy(4.dp)
                ) {
                    // Edited indicator
                    if (!message.isRecalled && message.editCount > 0) {
                        Text(
                            text = "Edited (${message.editCount})",
                            style = MaterialTheme.typography.labelSmall,
                            color = metaColor,
                            modifier = Modifier.clickable { onViewEditHistory() }
                        )
                    }

                    // Timestamp
                    if (showTimestamp) {
                        Text(
                            text = formatRelativeTime(message.createdAt),
                            style = MaterialTheme.typography.labelSmall,
                            color = metaColor
                        )
                    }

                    // Sending indicator
                    if (isSending) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(12.dp),
                            strokeWidth = 1.5.dp,
                            color = metaColor
                        )
                    }

                    // Read receipt (sent messages only, when actually sent)
                    if (isSent && message.sendStatus == SendStatus.SENT && !message.isRecalled) {
                        Icon(
                            imageVector = if (isRead) Icons.Default.DoneAll else Icons.Default.Done,
                            contentDescription = if (isRead) "Read" else "Sent",
                            modifier = Modifier.size(14.dp),
                            tint = metaColor
                        )
                    }
                }
            }

            // Reaction badges below the bubble (skip for recalled)
            if (!message.isRecalled && message.reactions.isNotEmpty()) {
                ReactionBadges(
                    reactions = message.reactions,
                    currentUserId = currentUserId,
                    onToggleReaction = onToggleReaction
                )
            }

            // Reaction picker popup — use Popup so it doesn't shift bubble layout
            if (showReactionPicker) {
                Popup(
                    alignment = if (isSent) Alignment.TopEnd else Alignment.TopStart,
                    onDismissRequest = { showReactionPicker = false },
                    properties = PopupProperties(focusable = true)
                ) {
                    ReactionPicker(
                        onReact = { emoji ->
                            showReactionPicker = false
                            onToggleReaction(emoji)
                        }
                    )
                }
            }

            // Context menu
            DropdownMenu(
                expanded = showContextMenu,
                onDismissRequest = { showContextMenu = false }
            ) {
                if (!message.isRecalled) {
                    DropdownMenuItem(
                        text = { Text("React") },
                        onClick = {
                            showContextMenu = false
                            showReactionPicker = !showReactionPicker
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Reply") },
                        onClick = {
                            showContextMenu = false
                            onReply()
                        }
                    )
                    DropdownMenuItem(
                        text = { Text("Copy") },
                        onClick = {
                            showContextMenu = false
                            @Suppress("DEPRECATION")
                            clipboardManager.setText(AnnotatedString(message.text))
                        }
                    )
                    if (canEdit) {
                        DropdownMenuItem(
                            text = { Text("Edit") },
                            onClick = {
                                showContextMenu = false
                                onEdit()
                            }
                        )
                    }
                    if (canRecall) {
                        DropdownMenuItem(
                            text = { Text("Recall") },
                            onClick = {
                                showContextMenu = false
                                onRecall()
                            }
                        )
                    }
                    if (message.type == PrivateMessageType.STICKER && !message.stickerUrl.isNullOrEmpty() && onSaveSticker != null) {
                        DropdownMenuItem(
                            text = { Text("Add to Stickers") },
                            onClick = {
                                showContextMenu = false
                                onSaveSticker(message.stickerUrl!!)
                            }
                        )
                    }
                    if (isGroupChat && isModOrAbove && !isSent && onHideMessage != null) {
                        DropdownMenuItem(
                            text = { Text("Hide Message") },
                            onClick = {
                                showContextMenu = false
                                onHideMessage()
                            }
                        )
                    }
                    if (!isSent) {
                        DropdownMenuItem(
                            text = { Text("Report Message") },
                            onClick = {
                                showContextMenu = false
                                onReportMessage()
                            }
                        )
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun LocalImageGrid(
    localImageData: List<ByteArray>,
    onLongClick: (() -> Unit)? = null
) {
    when (localImageData.size) {
        1 -> {
            AsyncImage(
                model = localImageData[0],
                contentDescription = "Image",
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .combinedClickable(
                        onClick = {},
                        onLongClick = { onLongClick?.invoke() }
                    ),
                contentScale = ContentScale.Crop
            )
        }
        2 -> {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                localImageData.forEach { data ->
                    AsyncImage(
                        model = data,
                        contentDescription = "Image",
                        modifier = Modifier
                            .weight(1f)
                            .height(150.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .combinedClickable(
                                onClick = {},
                                onLongClick = { onLongClick?.invoke() }
                            ),
                        contentScale = ContentScale.Crop
                    )
                }
            }
        }
        else -> {
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                localImageData.chunked(2).forEach { row ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        row.forEach { data ->
                            AsyncImage(
                                model = data,
                                contentDescription = "Image",
                                modifier = Modifier
                                    .weight(1f)
                                    .height(120.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .combinedClickable(
                                        onClick = {},
                                        onLongClick = { onLongClick?.invoke() }
                                    ),
                                contentScale = ContentScale.Crop
                            )
                        }
                        if (row.size == 1) {
                            Spacer(modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ImageGrid(
    imageUrls: List<String>,
    onImageClick: ((List<String>, Int) -> Unit)? = null,
    onLongClick: (() -> Unit)? = null
) {
    when (imageUrls.size) {
        1 -> {
            AsyncImage(
                model = imageUrls[0],
                contentDescription = "Image",
                modifier = Modifier
                    .fillMaxWidth()
                    .height(200.dp)
                    .clip(RoundedCornerShape(8.dp))
                    .combinedClickable(
                        onClick = { onImageClick?.invoke(imageUrls, 0) },
                        onLongClick = { onLongClick?.invoke() }
                    ),
                contentScale = ContentScale.Crop
            )
        }
        2 -> {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(4.dp)
            ) {
                imageUrls.forEachIndexed { index, url ->
                    AsyncImage(
                        model = url,
                        contentDescription = "Image",
                        modifier = Modifier
                            .weight(1f)
                            .height(150.dp)
                            .clip(RoundedCornerShape(8.dp))
                            .combinedClickable(
                                onClick = { onImageClick?.invoke(imageUrls, index) },
                                onLongClick = { onLongClick?.invoke() }
                            ),
                        contentScale = ContentScale.Crop
                    )
                }
            }
        }
        else -> {
            // Grid layout for 3+ images
            Column(verticalArrangement = Arrangement.spacedBy(4.dp)) {
                imageUrls.chunked(2).forEachIndexed { rowIndex, row ->
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(4.dp)
                    ) {
                        row.forEachIndexed { colIndex, url ->
                            val globalIndex = rowIndex * 2 + colIndex
                            AsyncImage(
                                model = url,
                                contentDescription = "Image",
                                modifier = Modifier
                                    .weight(1f)
                                    .height(120.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .combinedClickable(
                                        onClick = { onImageClick?.invoke(imageUrls, globalIndex) },
                                        onLongClick = { onLongClick?.invoke() }
                                    ),
                                contentScale = ContentScale.Crop
                            )
                        }
                        // If odd number in last row, add spacer
                        if (row.size == 1) {
                            Spacer(modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }
}
