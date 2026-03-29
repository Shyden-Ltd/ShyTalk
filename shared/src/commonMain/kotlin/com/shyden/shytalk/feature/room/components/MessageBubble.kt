package com.shyden.shytalk.feature.room.components

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
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontStyle
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.MessageType
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.ui.StyledDisplayName
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.ui.components.FlagBadge
import org.jetbrains.compose.resources.stringResource

private val BubbleShape =
    RoundedCornerShape(
        topStart = 4.dp,
        topEnd = 12.dp,
        bottomStart = 12.dp,
        bottomEnd = 12.dp,
    )

@Composable
private fun UserAvatar(
    photoUrl: String?,
    displayName: String,
    nationality: String? = null,
    size: Dp,
    onClick: () -> Unit,
) {
    Box(contentAlignment = Alignment.Center) {
        if (photoUrl != null) {
            AsyncImage(
                model = photoUrl,
                contentDescription = displayName,
                modifier =
                    Modifier
                        .size(size)
                        .clip(CircleShape)
                        .clickable(onClick = onClick),
                contentScale = ContentScale.Crop,
            )
        } else {
            Surface(
                modifier =
                    Modifier
                        .size(size)
                        .clickable(onClick = onClick),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
            ) {
                Icon(
                    Icons.Default.Person,
                    contentDescription = displayName,
                    modifier = Modifier.padding(if (size <= 24.dp) 4.dp else 6.dp),
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
        }
        if (nationality != null && size >= 32.dp) {
            FlagBadge(
                countryCode = nationality,
                badgeSize = size * 0.4f,
                modifier = Modifier.align(Alignment.BottomEnd),
            )
        }
    }
}

@Suppress("kotlin:S107", "kotlin:S3776")
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun MessageBubble(
    message: Message,
    user: User?,
    currentRole: RoomRole,
    isUserSeated: Boolean,
    isSelf: Boolean,
    onTapUser: () -> Unit,
    onInvite: () -> Unit,
    onEditMessage: (() -> Unit)? = null,
    onTranslate: (() -> Unit)? = null,
    translatedText: String? = null,
    aliases: Map<String, String> = emptyMap(),
) {
    val canInvite =
        (currentRole == RoomRole.OWNER || currentRole == RoomRole.HOST) &&
            !isSelf &&
            !isUserSeated &&
            message.senderId != "system"

    when (message.type) {
        MessageType.SYSTEM -> {
            Text(
                text = message.text,
                style = MaterialTheme.typography.bodySmall,
                fontStyle = FontStyle.Italic,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                textAlign = TextAlign.Center,
                modifier =
                    Modifier
                        .fillMaxWidth(0.75f)
                        .padding(vertical = 4.dp),
            )
        }
        MessageType.JOIN -> {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth(0.75f)
                        .padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.Start,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                UserAvatar(
                    photoUrl = user?.photoUrl,
                    displayName = message.senderName,
                    nationality = user?.nationality,
                    size = 24.dp,
                    onClick = onTapUser,
                )

                Spacer(modifier = Modifier.width(8.dp))

                Text(
                    text = message.text,
                    style = MaterialTheme.typography.bodySmall,
                    fontStyle = FontStyle.Italic,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )

                if (canInvite) {
                    Spacer(modifier = Modifier.width(4.dp))
                    IconButton(
                        onClick = onInvite,
                        modifier = Modifier.size(28.dp),
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Icon(
                                Icons.Default.Mic,
                                contentDescription = stringResource(Res.string.invite_to_mic),
                                modifier = Modifier.size(16.dp),
                                tint = MaterialTheme.colorScheme.primary,
                            )
                            Icon(
                                Icons.Default.Add,
                                contentDescription = null,
                                modifier =
                                    Modifier
                                        .size(10.dp)
                                        .align(Alignment.BottomEnd),
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
            }
        }
        MessageType.TEXT -> {
            val resolvedName = aliases[message.senderId] ?: message.senderName
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth(0.75f)
                        .padding(vertical = 2.dp),
                horizontalArrangement = Arrangement.Start,
                verticalAlignment = Alignment.Top,
            ) {
                UserAvatar(
                    photoUrl = user?.photoUrl,
                    displayName = resolvedName,
                    nationality = user?.nationality,
                    size = 32.dp,
                    onClick = onTapUser,
                )

                Spacer(modifier = Modifier.width(8.dp))

                Column(modifier = Modifier.weight(1f)) {
                    StyledDisplayName(
                        displayName = resolvedName,
                        isSuperShy = user?.isSuperShy ?: false,
                        style =
                            MaterialTheme.typography.labelSmall.copy(
                                color = MaterialTheme.colorScheme.primary,
                            ),
                    )

                    Surface(
                        shape = BubbleShape,
                        color =
                            if (isSelf) {
                                MaterialTheme.colorScheme.primaryContainer
                            } else {
                                MaterialTheme.colorScheme.surfaceVariant
                            },
                        modifier =
                            if (isSelf && onEditMessage != null) {
                                Modifier.combinedClickable(
                                    onClick = {},
                                    onLongClick = onEditMessage,
                                )
                            } else {
                                Modifier
                            },
                    ) {
                        Column(modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)) {
                            Text(
                                text = message.text,
                                style = MaterialTheme.typography.bodyMedium,
                                color =
                                    if (isSelf) {
                                        MaterialTheme.colorScheme.onPrimaryContainer
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    },
                            )
                            if (message.isEdited) {
                                Text(
                                    text = stringResource(Res.string.edited),
                                    style = MaterialTheme.typography.labelSmall,
                                    fontStyle = FontStyle.Italic,
                                    color =
                                        if (isSelf) {
                                            MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.6f)
                                        } else {
                                            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
                                        },
                                )
                            }
                            if (translatedText != null) {
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = translatedText,
                                    style = MaterialTheme.typography.bodyMedium,
                                    fontStyle = FontStyle.Italic,
                                    color =
                                        if (isSelf) {
                                            MaterialTheme.colorScheme.onPrimaryContainer.copy(alpha = 0.85f)
                                        } else {
                                            MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.85f)
                                        },
                                )
                            }
                            if (onTranslate != null && translatedText == null && !isSelf) {
                                Text(
                                    text = stringResource(Res.string.translate),
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.clickable { onTranslate() },
                                )
                            }
                        }
                    }
                }
            }
        }
        MessageType.GIFT -> {
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth(0.75f)
                        .padding(vertical = 4.dp),
                horizontalArrangement = Arrangement.Center,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                if (message.giftIconUrl.isNotEmpty()) {
                    AsyncImage(
                        model = message.giftIconUrl,
                        contentDescription = null,
                        modifier =
                            Modifier
                                .size(20.dp)
                                .clip(CircleShape),
                        contentScale = ContentScale.Crop,
                    )
                } else {
                    Icon(
                        Icons.Default.CardGiftcard,
                        contentDescription = null,
                        modifier = Modifier.size(20.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = message.text,
                    style = MaterialTheme.typography.bodySmall,
                    fontStyle = FontStyle.Italic,
                    color = MaterialTheme.colorScheme.primary,
                )
            }
        }
    }
}
