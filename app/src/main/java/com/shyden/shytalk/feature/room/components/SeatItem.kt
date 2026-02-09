package com.shyden.shytalk.feature.room.components

import androidx.compose.animation.animateColorAsState
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.Icon
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
import androidx.compose.ui.draw.clip
import androidx.compose.ui.draw.scale
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil.compose.AsyncImage
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SeatItem(
    seatIndex: Int,
    seat: Seat,
    seatRole: RoomRole,
    isCurrentUser: Boolean,
    canLeaveSeat: Boolean,
    isSpeaking: Boolean,
    user: User? = null,
    onClick: () -> Unit,
    onTapUser: (() -> Unit)? = null,
    modifier: Modifier = Modifier
) {
    var showMenu by remember { mutableStateOf(false) }

    // Speaking animation
    val infiniteTransition = rememberInfiniteTransition(label = "speaking")
    val speakingScale by infiniteTransition.animateFloat(
        initialValue = 1f,
        targetValue = 1.15f,
        animationSpec = infiniteRepeatable(
            animation = tween(400),
            repeatMode = RepeatMode.Reverse
        ),
        label = "speakingScale"
    )

    val borderColor by animateColorAsState(
        targetValue = when {
            isSpeaking -> Color(0xFF4CAF50) // Green for speaking
            seatRole == RoomRole.OWNER -> MaterialTheme.colorScheme.primary
            seatRole == RoomRole.HOST -> MaterialTheme.colorScheme.tertiary
            else -> Color.Transparent
        },
        label = "borderColor"
    )

    Column(
        modifier = modifier.padding(4.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Box(contentAlignment = Alignment.Center) {
            Surface(
                modifier = Modifier
                    .size(56.dp)
                    .then(
                        if (isSpeaking) Modifier.scale(speakingScale) else Modifier
                    )
                    .then(
                        if (borderColor != Color.Transparent) {
                            Modifier.border(
                                width = if (isSpeaking) 3.dp else 2.dp,
                                color = borderColor,
                                shape = CircleShape
                            )
                        } else {
                            Modifier
                        }
                    )
                    .combinedClickable(
                        onClick = {
                            if (seat.state == SeatState.OCCUPIED && !isCurrentUser && onTapUser != null) {
                                onTapUser()
                            } else {
                                onClick()
                            }
                        },
                        onLongClick = {
                            if (canLeaveSeat) {
                                showMenu = true
                            }
                        }
                    ),
                shape = CircleShape,
                color = if (seat.state == SeatState.OCCUPIED) {
                    MaterialTheme.colorScheme.primaryContainer
                } else {
                    MaterialTheme.colorScheme.surfaceVariant
                }
            ) {
                val photoUrl = user?.profilePhotoUrl ?: user?.avatarUrl
                if (seat.state == SeatState.OCCUPIED && photoUrl != null) {
                    AsyncImage(
                        model = photoUrl,
                        contentDescription = user?.displayName ?: "User",
                        modifier = Modifier
                            .size(56.dp)
                            .clip(CircleShape),
                        contentScale = ContentScale.Crop
                    )
                } else {
                    Icon(
                        imageVector = if (seat.state == SeatState.OCCUPIED) {
                            Icons.Default.Person
                        } else {
                            Icons.Default.PersonAdd
                        },
                        contentDescription = if (seat.state == SeatState.OCCUPIED) "Occupied" else "Empty seat",
                        modifier = Modifier.padding(14.dp),
                        tint = if (seat.state == SeatState.OCCUPIED) {
                            MaterialTheme.colorScheme.onPrimaryContainer
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        }
                    )
                }
            }

            // Role indicator badge
            if (seat.state == SeatState.OCCUPIED && seatRole != RoomRole.ATTENDEE) {
                Box(
                    modifier = Modifier
                        .align(Alignment.TopEnd)
                        .size(18.dp)
                        .clip(CircleShape)
                        .background(
                            if (seatRole == RoomRole.OWNER) MaterialTheme.colorScheme.primary
                            else MaterialTheme.colorScheme.tertiary
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        Icons.Default.Star,
                        contentDescription = seatRole.name,
                        modifier = Modifier.size(12.dp),
                        tint = MaterialTheme.colorScheme.onPrimary
                    )
                }
            }

            // Mic status indicator
            if (seat.state == SeatState.OCCUPIED) {
                Box(
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .size(18.dp)
                        .clip(CircleShape)
                        .background(
                            if (seat.isMuted) MaterialTheme.colorScheme.error
                            else Color(0xFF4CAF50)
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Icon(
                        if (seat.isMuted) Icons.Default.MicOff else Icons.Default.Mic,
                        contentDescription = if (seat.isMuted) "Muted" else "Unmuted",
                        modifier = Modifier.size(12.dp),
                        tint = Color.White
                    )
                }
            }

            // Context menu (only leave seat for current user)
            DropdownMenu(
                expanded = showMenu,
                onDismissRequest = { showMenu = false }
            ) {
                if (canLeaveSeat) {
                    DropdownMenuItem(
                        text = { Text("Leave seat") },
                        onClick = {
                            showMenu = false
                            onClick()
                        }
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(4.dp))

        Text(
            text = if (seat.state == SeatState.OCCUPIED && user != null) {
                user.displayName.ifEmpty { "Seat ${seatIndex + 1}" }
            } else {
                "Seat ${seatIndex + 1}"
            },
            style = MaterialTheme.typography.labelSmall,
            textAlign = TextAlign.Center,
            maxLines = 1,
            overflow = TextOverflow.Ellipsis
        )
    }
}
