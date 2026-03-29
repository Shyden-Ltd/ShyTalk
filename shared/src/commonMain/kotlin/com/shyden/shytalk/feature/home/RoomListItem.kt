package com.shyden.shytalk.feature.home

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Person
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.flagEmojiForCode
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource

private val BottomGradient =
    Brush.verticalGradient(
        colors = listOf(Color.Transparent, Color.Black.copy(alpha = 0.7f)),
        startY = 60f,
    )

private val WhiteAlpha80 = Color.White.copy(alpha = 0.8f)

@Suppress("kotlin:S3776")
@Composable
fun RoomListItem(
    room: ChatRoom,
    seatUsers: Map<String, User>,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val occupiedSeats =
        remember(room.seats) {
            room.seats.values.count { it.state == SeatState.OCCUPIED }
        }
    val totalSeats = room.seats.size

    // Build ordered list of seated users + nationality flags in a single pass
    val (seatedUserList, nationalityFlags) =
        remember(room.seats, room.state, seatUsers) {
            if (room.state == RoomState.CLOSED) {
                // Closed rooms: seats are cleared, so use seatUsers directly
                // (populated from allTimeSeatUserIds by the ViewModel)
                val users = seatUsers.values.toList()
                val nationalities = users.mapNotNull { it.nationality }.toSet()
                users to nationalities.map { flagEmojiForCode(it) }
            } else {
                // Active rooms: use live seat occupancy
                val nationalities = mutableSetOf<String>()
                val users =
                    buildList {
                        // Owner seat first
                        room.seats["0"]?.let { seat ->
                            if (seat.state == SeatState.OCCUPIED && seat.userId != null) {
                                seatUsers[seat.userId]?.let {
                                    add(it)
                                    it.nationality?.let(nationalities::add)
                                }
                            }
                        }
                        // Then remaining seats in order
                        for (i in 1 until totalSeats) {
                            room.seats[i.toString()]?.let { seat ->
                                if (seat.state == SeatState.OCCUPIED && seat.userId != null) {
                                    seatUsers[seat.userId]?.let {
                                        add(it)
                                        it.nationality?.let(nationalities::add)
                                    }
                                }
                            }
                        }
                    }
                users to nationalities.map { flagEmojiForCode(it) }
            }
        }

    Card(
        colors = CardDefaults.cardColors(),
        modifier =
            modifier
                .fillMaxWidth()
                .padding(horizontal = 16.dp, vertical = 4.dp)
                .clickable(onClick = onClick),
    ) {
        Box {
            // Full-bleed profile photos (owner is always seated)
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(140.dp),
            ) {
                seatedUserList.forEach { user ->
                    val photoUrl = user.photoUrl
                    Box(
                        modifier =
                            Modifier
                                .weight(1f)
                                .height(140.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        if (photoUrl != null) {
                            AsyncImage(
                                model = photoUrl,
                                contentDescription = user.displayName,
                                modifier = Modifier.fillMaxSize(),
                                contentScale = ContentScale.Crop,
                            )
                        } else {
                            Box(
                                modifier =
                                    Modifier
                                        .fillMaxSize()
                                        .background(MaterialTheme.colorScheme.primaryContainer),
                                contentAlignment = Alignment.Center,
                            ) {
                                Icon(
                                    Icons.Default.Person,
                                    contentDescription = user.displayName,
                                    modifier = Modifier.fillMaxSize(0.4f),
                                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                                )
                            }
                        }
                    }
                }
            }

            // Gradient overlay at bottom for text readability
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(140.dp)
                        .background(BottomGradient),
            )

            // Room info overlay
            Column(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(140.dp)
                        .padding(12.dp),
                verticalArrangement = Arrangement.Bottom,
            ) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    verticalAlignment = Alignment.Bottom,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = room.name,
                            style = MaterialTheme.typography.titleMedium,
                            color = Color.White,
                            maxLines = 1,
                            overflow = TextOverflow.Ellipsis,
                        )
                        Text(
                            text =
                                if (room.state == RoomState.CLOSED) {
                                    stringResource(Res.string.speakers_count, seatUsers.size, totalSeats)
                                } else {
                                    stringResource(Res.string.seats_count, occupiedSeats, totalSeats)
                                },
                            style = MaterialTheme.typography.bodySmall,
                            color = WhiteAlpha80,
                        )
                    }

                    Column(horizontalAlignment = Alignment.End) {
                        Text(
                            text =
                                if (room.state == RoomState.CLOSED) {
                                    stringResource(Res.string.visitors_count, room.firstJoinTimestamps.size)
                                } else {
                                    stringResource(Res.string.in_room_count, room.participantIds.size)
                                },
                            style = MaterialTheme.typography.labelMedium,
                            color = Color.White,
                        )
                        if (nationalityFlags.isNotEmpty()) {
                            Spacer(modifier = Modifier.height(2.dp))
                            Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                nationalityFlags.take(6).forEach { flag ->
                                    Text(
                                        text = flag,
                                        style = MaterialTheme.typography.labelSmall,
                                    )
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
