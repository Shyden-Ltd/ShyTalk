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
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.requiredSize
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Mic
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonAdd
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
import androidx.compose.ui.draw.alpha
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.ui.StyledDisplayName
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.ui.components.FlagBadge
import com.shyden.shytalk.ui.theme.SpeakingGreen
import org.jetbrains.compose.resources.stringResource

@OptIn(ExperimentalFoundationApi::class)
@Composable
fun SeatItem(
    seatIndex: Int,
    seat: Seat,
    seatRole: RoomRole,
    isCurrentUser: Boolean,
    canLeaveSeat: Boolean,
    isSpeaking: Boolean,
    isDisconnected: Boolean = false,
    isRequestSeat: Boolean = false,
    user: User? = null,
    seatSize: Dp = 70.dp,
    onClick: () -> Unit,
    onTapUser: (() -> Unit)? = null,
    aliases: Map<String, String> = emptyMap(),
    modifier: Modifier = Modifier,
) {
    var showMenu by remember { mutableStateOf(false) }

    // Scale badges and icon padding proportionally to seat size (memoized)
    val (badgeSize, badgeIconSize, iconPadding, flagFontSize) =
        remember(seatSize) {
            val scale = (seatSize / 70.dp).coerceIn(1f, 1.5f)

            data class SeatMetrics(
                val badge: Dp,
                val badgeIcon: Dp,
                val iconPad: Dp,
                val flagFont: Float,
            )
            SeatMetrics(
                badge = seatSize * 0.4f,
                badgeIcon = (14.dp * scale).coerceAtMost(18.dp),
                iconPad = (14.dp * (seatSize / 70.dp)).coerceIn(14.dp, 40.dp),
                flagFont = (seatSize.value * 0.28f).coerceAtLeast(12f),
            )
        }

    val borderColor by animateColorAsState(
        targetValue = if (isSpeaking) SpeakingGreen else Color.Transparent,
        label = "borderColor",
    )

    // Max border so we can reserve stable layout space
    val maxBorderWidth = 8.dp

    // Pulsing border width when speaking — always create transition for stable composition
    val infiniteTransition = rememberInfiniteTransition(label = "speakingPulse")
    val pulsingWidth by infiniteTransition.animateFloat(
        initialValue = 2f,
        targetValue = 8f,
        animationSpec =
            infiniteRepeatable(
                animation = tween(600),
                repeatMode = RepeatMode.Reverse,
            ),
        label = "borderPulse",
    )
    val borderWidth = if (isSpeaking) pulsingWidth.dp else 2.dp

    // Always reserve max border space so the layout never shifts
    val outerSize = seatSize + maxBorderWidth * 2

    Column(
        modifier =
            modifier
                .padding(4.dp)
                .alpha(if (isDisconnected) 0.4f else 1f),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Box(contentAlignment = Alignment.Center) {
            // Fixed-size outer box — border pulses inside without affecting layout
            Box(
                modifier =
                    Modifier
                        .requiredSize(outerSize)
                        .then(
                            if (borderColor != Color.Transparent) {
                                Modifier.border(
                                    width = borderWidth,
                                    color = borderColor,
                                    shape = CircleShape,
                                )
                            } else {
                                Modifier
                            },
                        ),
                contentAlignment = Alignment.Center,
            ) {
                Surface(
                    modifier =
                        Modifier
                            .requiredSize(seatSize)
                            .combinedClickable(
                                onClick = {
                                    if (seat.state == SeatState.OCCUPIED && onTapUser != null) {
                                        onTapUser()
                                    } else {
                                        onClick()
                                    }
                                },
                                onLongClick = {
                                    if (canLeaveSeat) {
                                        showMenu = true
                                    }
                                },
                            ),
                    shape = CircleShape,
                    color =
                        if (seat.state == SeatState.OCCUPIED) {
                            MaterialTheme.colorScheme.primaryContainer
                        } else {
                            MaterialTheme.colorScheme.surfaceVariant
                        },
                ) {
                    val photoUrl = user?.photoUrl
                    if (seat.state == SeatState.OCCUPIED && photoUrl != null) {
                        AsyncImage(
                            model = photoUrl,
                            contentDescription = user.displayName,
                            modifier =
                                Modifier
                                    .size(seatSize)
                                    .clip(CircleShape),
                            contentScale = ContentScale.Crop,
                        )
                    } else {
                        Icon(
                            imageVector =
                                if (seat.state == SeatState.OCCUPIED) {
                                    Icons.Default.Person
                                } else {
                                    Icons.Default.PersonAdd
                                },
                            contentDescription =
                                if (seat.state ==
                                    SeatState.OCCUPIED
                                ) {
                                    stringResource(Res.string.occupied)
                                } else {
                                    stringResource(Res.string.empty_seat)
                                },
                            modifier = Modifier.padding(iconPadding),
                            tint =
                                if (seat.state == SeatState.OCCUPIED) {
                                    MaterialTheme.colorScheme.onPrimaryContainer
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant
                                },
                        )
                    }
                }
            }

            // Nationality flag badge (overlapping avatar border, bottom-end)
            val nationality = user?.nationality
            if (seat.state == SeatState.OCCUPIED && nationality != null) {
                FlagBadge(
                    countryCode = nationality,
                    badgeSize = badgeSize,
                    modifier = Modifier.align(Alignment.BottomEnd),
                )
            }

            // Context menu (only leave seat for current user)
            DropdownMenu(
                expanded = showMenu,
                onDismissRequest = { showMenu = false },
            ) {
                if (canLeaveSeat) {
                    DropdownMenuItem(
                        text = { Text(stringResource(Res.string.leave_seat)) },
                        onClick = {
                            showMenu = false
                            onClick()
                        },
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(4.dp))

        // Memoize shadow style to avoid allocating a new Shadow on every recomposition
        val textShadowStyle =
            MaterialTheme.typography.labelSmall.copy(
                shadow =
                    Shadow(
                        color = MaterialTheme.colorScheme.background,
                        offset = Offset.Zero,
                        blurRadius = 8f,
                    ),
            )

        if (seat.state == SeatState.OCCUPIED && user != null) {
            val userText = stringResource(Res.string.user)
            val name = aliases[user.uid]?.ifEmpty { null } ?: user.displayName.ifEmpty { userText }
            val isHostOrOwner = seatRole == RoomRole.OWNER || seatRole == RoomRole.HOST
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
            ) {
                Box(
                    modifier =
                        Modifier
                            .size(16.dp)
                            .clip(CircleShape)
                            .background(
                                if (isHostOrOwner) {
                                    MaterialTheme.colorScheme.primary
                                } else {
                                    Color.Transparent
                                },
                            ),
                    contentAlignment = Alignment.Center,
                ) {
                    Text(
                        text = "${seatIndex + 1}",
                        style = MaterialTheme.typography.labelSmall.copy(fontSize = 9.sp),
                        color =
                            if (isHostOrOwner) {
                                MaterialTheme.colorScheme.onPrimary
                            } else {
                                MaterialTheme.colorScheme.onSurfaceVariant
                            },
                    )
                }
                Spacer(modifier = Modifier.width(3.dp))
                StyledDisplayName(
                    displayName = name,
                    isSuperShy = user.isSuperShy,
                    style =
                        textShadowStyle.copy(
                            color = MaterialTheme.colorScheme.onBackground,
                        ),
                    modifier = Modifier.weight(1f, fill = false),
                )
                Spacer(modifier = Modifier.width(3.dp))
                Icon(
                    if (seat.isMuted) Icons.Default.MicOff else Icons.Default.Mic,
                    contentDescription = if (seat.isMuted) stringResource(Res.string.muted) else stringResource(Res.string.unmuted),
                    modifier = Modifier.size(12.dp),
                    tint = if (seat.isMuted) MaterialTheme.colorScheme.error else SpeakingGreen,
                )
            }
        } else {
            Text(
                text = if (isRequestSeat) stringResource(Res.string.request) else stringResource(Res.string.seat_number, seatIndex + 1),
                style = textShadowStyle,
                color = MaterialTheme.colorScheme.onBackground,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}
