package com.shyden.shytalk.feature.room.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.ui.StyledDisplayName
import com.shyden.shytalk.core.util.flagEmojiForCode
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource

data class ParticipantInfo(
    val user: User,
    val role: RoomRole,
    val isMuted: Boolean = false,
)

@Composable
fun ParticipantListPanel(
    voiceUsers: List<ParticipantInfo>,
    audienceUsers: List<ParticipantInfo>,
    pendingRequests: List<SeatRequest> = emptyList(),
    pendingInviteUserIds: Set<String> = emptySet(),
    seatedUserIds: Set<String> = emptySet(),
    isOwnerOrHost: Boolean = false,
    onUserClick: (String) -> Unit,
    onApproveRequest: (SeatRequest) -> Unit = {},
    onDenyRequest: (SeatRequest) -> Unit = {},
    onInviteUser: (String, String) -> Unit = { _, _ -> },
    onDismiss: () -> Unit,
    aliases: Map<String, String> = emptyMap(),
    modifier: Modifier = Modifier,
) {
    Surface(
        modifier = modifier,
        color = MaterialTheme.colorScheme.surface,
        shadowElevation = 8.dp,
        tonalElevation = 2.dp,
    ) {
        Column(modifier = Modifier.fillMaxHeight()) {
            // Header
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(start = 16.dp, end = 4.dp, top = 8.dp, bottom = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(Res.string.participants),
                    style = MaterialTheme.typography.titleMedium,
                    modifier = Modifier.weight(1f),
                )
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = stringResource(Res.string.close))
                }
            }
            HorizontalDivider()

            // List
            val requestByUserId =
                remember(pendingRequests) {
                    pendingRequests.associateBy { it.userId }
                }

            LazyColumn(modifier = Modifier.fillMaxSize()) {
                // Voice section
                item { SectionHeader(stringResource(Res.string.voice), voiceUsers.size) }
                if (voiceUsers.isEmpty()) {
                    item {
                        Text(
                            text = stringResource(Res.string.no_one_on_mic),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                        )
                    }
                }
                items(voiceUsers, key = { it.user.uid }) { participant ->
                    ParticipantRow(
                        participant = participant,
                        aliases = aliases,
                        onClick = { onUserClick(participant.user.uid) },
                    )
                }

                // Audience section
                item {
                    HorizontalDivider(modifier = Modifier.padding(vertical = 4.dp))
                    SectionHeader(stringResource(Res.string.audience), audienceUsers.size)
                }
                if (audienceUsers.isEmpty()) {
                    item {
                        Text(
                            text = stringResource(Res.string.no_audience_members),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                        )
                    }
                }
                items(audienceUsers, key = { it.user.uid }) { participant ->
                    val pendingRequest = requestByUserId[participant.user.uid]
                    val hasPendingInvite = participant.user.uid in pendingInviteUserIds
                    val canInvite =
                        isOwnerOrHost &&
                            pendingRequest == null &&
                            !hasPendingInvite &&
                            participant.user.uid !in seatedUserIds
                    ParticipantRow(
                        participant = participant,
                        pendingRequest = pendingRequest,
                        isOwnerOrHost = isOwnerOrHost,
                        onApprove = pendingRequest?.let { req -> { onApproveRequest(req) } },
                        onDeny = pendingRequest?.let { req -> { onDenyRequest(req) } },
                        onInvite =
                            if (canInvite) {
                                { onInviteUser(participant.user.uid, participant.user.displayName) }
                            } else {
                                null
                            },
                        aliases = aliases,
                        onClick = { onUserClick(participant.user.uid) },
                    )
                }
            }
        }
    }
}

@Composable
private fun SectionHeader(
    title: String,
    count: Int,
) {
    Text(
        text = "$title ($count)",
        style = MaterialTheme.typography.titleSmall,
        color = MaterialTheme.colorScheme.onSurfaceVariant,
        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
    )
}

@Composable
private fun ParticipantRow(
    participant: ParticipantInfo,
    pendingRequest: SeatRequest? = null,
    isOwnerOrHost: Boolean = false,
    onApprove: (() -> Unit)? = null,
    onDeny: (() -> Unit)? = null,
    onInvite: (() -> Unit)? = null,
    aliases: Map<String, String> = emptyMap(),
    onClick: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        // Avatar with nationality flag
        Box(contentAlignment = Alignment.Center) {
            val photoUrl = participant.user.photoUrl
            if (photoUrl != null) {
                AsyncImage(
                    model = photoUrl,
                    contentDescription = participant.user.displayName,
                    modifier =
                        Modifier
                            .size(40.dp)
                            .clip(CircleShape),
                    contentScale = ContentScale.Crop,
                )
            } else {
                Surface(
                    modifier = Modifier.size(40.dp),
                    shape = CircleShape,
                    color = MaterialTheme.colorScheme.primaryContainer,
                ) {
                    Icon(
                        Icons.Default.Person,
                        contentDescription = null,
                        modifier = Modifier.padding(8.dp),
                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                    )
                }
            }
            val nationality = participant.user.nationality
            if (nationality != null) {
                Box(
                    modifier =
                        Modifier
                            .align(Alignment.BottomEnd)
                            .size(16.dp),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = flagEmojiForCode(nationality),
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 11.sp),
                    )
                }
            }
        }

        // Name
        val unknownText = stringResource(Res.string.unknown)
        val resolvedName = aliases[participant.user.uid] ?: participant.user.displayName.ifEmpty { unknownText }
        StyledDisplayName(
            displayName = resolvedName,
            isSuperShy = participant.user.isSuperShy,
            style = MaterialTheme.typography.bodyMedium,
            modifier = Modifier.weight(1f),
        )

        // Seat request actions (audience members only)
        if (pendingRequest != null && isOwnerOrHost) {
            IconButton(onClick = { onApprove?.invoke() }, modifier = Modifier.size(32.dp)) {
                Icon(
                    Icons.Default.Check,
                    contentDescription = stringResource(Res.string.approve),
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp),
                )
            }
            IconButton(onClick = { onDeny?.invoke() }, modifier = Modifier.size(32.dp)) {
                Icon(
                    Icons.Default.Close,
                    contentDescription = stringResource(Res.string.deny),
                    tint = MaterialTheme.colorScheme.error,
                    modifier = Modifier.size(18.dp),
                )
            }
        } else if (pendingRequest != null) {
            Text(
                text = stringResource(Res.string.requesting),
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.tertiary,
            )
        } else if (onInvite != null) {
            IconButton(onClick = onInvite, modifier = Modifier.size(32.dp)) {
                Icon(
                    Icons.Default.PersonAdd,
                    contentDescription = stringResource(Res.string.invite_to_seat),
                    tint = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.size(18.dp),
                )
            }
        }

        // Role badge
        if (participant.role != RoomRole.ATTENDEE) {
            Surface(
                shape = RoundedCornerShape(4.dp),
                color =
                    if (participant.role == RoomRole.OWNER) {
                        MaterialTheme.colorScheme.primary
                    } else {
                        MaterialTheme.colorScheme.tertiary
                    },
            ) {
                Text(
                    text = if (participant.role == RoomRole.OWNER) stringResource(Res.string.owner) else stringResource(Res.string.host),
                    style = MaterialTheme.typography.labelSmall,
                    color =
                        if (participant.role == RoomRole.OWNER) {
                            MaterialTheme.colorScheme.onPrimary
                        } else {
                            MaterialTheme.colorScheme.onTertiary
                        },
                    modifier = Modifier.padding(horizontal = 6.dp, vertical = 2.dp),
                )
            }
        }

        // Mute indicator (voice users only)
        if (participant.isMuted) {
            Icon(
                Icons.Default.MicOff,
                contentDescription = stringResource(Res.string.muted),
                modifier = Modifier.size(16.dp),
                tint = MaterialTheme.colorScheme.error,
            )
        }
    }
}
