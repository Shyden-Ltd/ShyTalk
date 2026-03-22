package com.shyden.shytalk.feature.messaging

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.NotificationsOff
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PushPin
import androidx.compose.material3.Badge
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.GroupRole
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.ui.StyledDisplayName
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.formatRelativeTime
import com.shyden.shytalk.core.util.rememberRelativeTimeStrings
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.ui.theme.SpeakingGreen
import org.jetbrains.compose.resources.stringResource

@Composable
fun ConversationListItem(
    otherUser: User?,
    lastMessageText: String?,
    lastMessageType: String?,
    lastMessageAt: Long,
    unreadCount: Long,
    isMuted: Boolean,
    isPinned: Boolean,
    onClick: () -> Unit,
    isGroup: Boolean = false,
    groupName: String? = null,
    groupPhotoUrl: String? = null,
    currentUserRole: GroupRole = GroupRole.MEMBER,
    aliases: Map<String, String> = emptyMap(),
    modifier: Modifier = Modifier,
) {
    val timeStrings = rememberRelativeTimeStrings()
    Row(
        modifier =
            modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(horizontal = 16.dp, vertical = 12.dp),
        verticalAlignment = Alignment.CenterVertically,
    ) {
        // Avatar
        if (isGroup) {
            val groupPhoto = groupPhotoUrl
            if (groupPhoto != null) {
                AsyncImage(
                    model = groupPhoto,
                    contentDescription = groupName,
                    modifier =
                        Modifier
                            .size(52.dp)
                            .clip(CircleShape),
                    contentScale = ContentScale.Crop,
                )
            } else {
                Surface(
                    modifier = Modifier.size(52.dp),
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primaryContainer,
                ) {
                    Icon(
                        Icons.Default.Group,
                        contentDescription = null,
                        modifier = Modifier.padding(14.dp),
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
            }
        } else {
            val photoUrl = otherUser?.photoUrl
            if (photoUrl != null) {
                AsyncImage(
                    model = photoUrl,
                    contentDescription = otherUser.displayName,
                    modifier =
                        Modifier
                            .size(52.dp)
                            .clip(CircleShape),
                    contentScale = ContentScale.Crop,
                )
            } else {
                Surface(
                    modifier = Modifier.size(52.dp),
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primaryContainer,
                ) {
                    Icon(
                        Icons.Default.Person,
                        contentDescription = null,
                        modifier = Modifier.padding(14.dp),
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
            }
        }

        Spacer(modifier = Modifier.width(12.dp))

        // Name + message preview
        Column(
            modifier = Modifier.weight(1f),
            verticalArrangement = Arrangement.spacedBy(2.dp),
        ) {
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(4.dp),
            ) {
                val resolvedName =
                    if (isGroup) {
                        groupName ?: stringResource(Res.string.group)
                    } else {
                        otherUser?.uid?.let { aliases[it] } ?: otherUser?.displayName ?: stringResource(Res.string.unknown)
                    }
                StyledDisplayName(
                    displayName = resolvedName,
                    isSuperShy = !isGroup && otherUser?.isSuperShy == true,
                    style = MaterialTheme.typography.bodyLarge,
                    modifier = Modifier.weight(1f, fill = false),
                )
                if (isGroup && currentUserRole != GroupRole.MEMBER) {
                    val (badgeColor, badgeLabel) =
                        when (currentUserRole) {
                            GroupRole.OWNER ->
                                Pair(
                                    androidx.compose.ui.graphics
                                        .Color(0xFFFFD700),
                                    stringResource(Res.string.role_owner),
                                )
                            GroupRole.ADMIN ->
                                Pair(
                                    androidx.compose.ui.graphics
                                        .Color(0xFFFFC107),
                                    stringResource(Res.string.role_admin),
                                )
                            GroupRole.MOD ->
                                Pair(
                                    androidx.compose.ui.graphics
                                        .Color(0xFF009688),
                                    stringResource(Res.string.role_mod),
                                )
                            GroupRole.MEMBER -> Pair(MaterialTheme.colorScheme.outline, "")
                        }
                    if (badgeLabel.isNotEmpty()) {
                        Text(
                            text = badgeLabel,
                            style = MaterialTheme.typography.labelSmall,
                            color = badgeColor,
                        )
                    }
                }
                if (isPinned) {
                    Icon(
                        Icons.Default.PushPin,
                        contentDescription = stringResource(Res.string.pin),
                        modifier = Modifier.size(14.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
                if (isMuted) {
                    Icon(
                        Icons.Default.NotificationsOff,
                        contentDescription = stringResource(Res.string.muted),
                        modifier = Modifier.size(14.dp),
                        tint = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            // Online status or last message preview
            val onlineThreshold = currentTimeMillis() - Constants.ONLINE_THRESHOLD_MS
            val isSystemUser = otherUser?.uid == Constants.SYSTEM_USER_ID
            val isOnline =
                !isGroup &&
                    !isSystemUser &&
                    otherUser?.hideOnlineStatus != true &&
                    (otherUser?.lastSeenAt ?: 0) > onlineThreshold

            val previewText =
                when {
                    lastMessageText == "[Message recalled]" -> stringResource(Res.string.message_preview_recalled)
                    lastMessageType == "IMAGE" -> stringResource(Res.string.message_preview_image)
                    lastMessageType == "STICKER" -> stringResource(Res.string.message_preview_sticker)
                    lastMessageType == "ROOM_INVITE" -> stringResource(Res.string.message_preview_room_invite)
                    !lastMessageText.isNullOrBlank() -> lastMessageText
                    else -> stringResource(Res.string.start_conversation)
                }
            Row(verticalAlignment = Alignment.CenterVertically) {
                if (isOnline) {
                    Box(
                        modifier =
                            Modifier
                                .size(8.dp)
                                .clip(CircleShape)
                                .background(SpeakingGreen),
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                }
                Text(
                    text = previewText,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis,
                )
            }
        }

        Spacer(modifier = Modifier.width(8.dp))

        // Timestamp + unread badge
        Column(
            horizontalAlignment = Alignment.End,
            verticalArrangement = Arrangement.spacedBy(4.dp),
        ) {
            Text(
                text = formatRelativeTime(lastMessageAt, timeStrings),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (unreadCount > 0 && !isMuted) {
                Badge(
                    containerColor = MaterialTheme.colorScheme.primary,
                ) {
                    Text(
                        text = if (unreadCount > 99) "99+" else "$unreadCount",
                        style = MaterialTheme.typography.labelSmall,
                    )
                }
            }
        }
    }
}
