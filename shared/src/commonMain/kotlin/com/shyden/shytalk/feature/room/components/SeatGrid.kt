package com.shyden.shytalk.feature.room.components

import androidx.compose.animation.core.animateDpAsState
import androidx.compose.animation.core.tween
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.ui.Alignment
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Constants

@Composable
fun SeatGrid(
    seats: Map<String, Seat>,
    currentUserId: String,
    currentRole: RoomRole,
    ownerId: String,
    hostIds: Set<String>,
    speakingUserIds: Set<String>,
    seatUsers: Map<String, User> = emptyMap(),
    disconnectedUserIds: Set<String> = emptySet(),
    isOwnerAway: Boolean = false,
    showRequestSeat: Boolean = false,
    onSeatClick: (Int) -> Unit,
    onTapUser: (String) -> Unit = {},
    modifier: Modifier = Modifier
) {
    // Single pass: build occupied seats + optional request seat in one remember block
    val (displaySeats, requestSeatIndex) = remember(seats, showRequestSeat) {
        val occupied = seats.entries
            .filter { it.value.state == SeatState.OCCUPIED }
            .sortedBy { it.key.toIntOrNull() ?: 0 }

        if (showRequestSeat) {
            val firstEmpty = seats.entries
                .filter { it.value.state == SeatState.EMPTY }
                .minByOrNull { it.key.toIntOrNull() ?: Int.MAX_VALUE }
            if (firstEmpty != null) {
                (occupied + firstEmpty) to (firstEmpty.key.toIntOrNull())
            } else {
                occupied to null
            }
        } else {
            occupied to null
        }
    }

    val count = displaySeats.size

    val targetSeatSize = remember(count) {
        when (count) {
            1    -> 160.dp
            2    -> 120.dp
            3    -> 100.dp
            4    ->  90.dp
            5, 6 ->  80.dp
            7, 8 ->  70.dp
            else ->  70.dp
        }
    }

    val seatSize by animateDpAsState(
        targetValue = targetSeatSize,
        animationSpec = tween(durationMillis = 300),
        label = "seatSize"
    )

    // Split into 2 rows: top row always fills up to 4 seats first, overflow goes to row 2
    val (row1, row2) = remember(displaySeats) {
        if (count <= 4) {
            displaySeats to emptyList()
        } else {
            displaySeats.take(4) to displaySeats.drop(4)
        }
    }

    BoxWithConstraints(
        modifier = modifier,
        contentAlignment = Alignment.Center
    ) {
        val maxItemsPerRow = if (count <= 4) count.coerceAtLeast(1) else 4
        val maxSeatSize = (maxWidth / maxItemsPerRow) - 24.dp
        val cappedSeatSize = seatSize.coerceAtMost(maxSeatSize)

        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.spacedBy(12.dp)
        ) {
            SeatRow(
                seats = row1,
                currentUserId = currentUserId,
                currentRole = currentRole,
                ownerId = ownerId,
                hostIds = hostIds,
                speakingUserIds = speakingUserIds,
                seatUsers = seatUsers,
                disconnectedUserIds = disconnectedUserIds,
                isOwnerAway = isOwnerAway,
                seatSize = cappedSeatSize,
                requestSeatIndex = requestSeatIndex,
                onSeatClick = onSeatClick,
                onTapUser = onTapUser
            )
            if (row2.isNotEmpty()) {
                SeatRow(
                    seats = row2,
                    currentUserId = currentUserId,
                    currentRole = currentRole,
                    ownerId = ownerId,
                    hostIds = hostIds,
                    speakingUserIds = speakingUserIds,
                    seatUsers = seatUsers,
                    disconnectedUserIds = disconnectedUserIds,
                    isOwnerAway = isOwnerAway,
                    seatSize = cappedSeatSize,
                    requestSeatIndex = requestSeatIndex,
                    onSeatClick = onSeatClick,
                    onTapUser = onTapUser
                )
            }
        }
    }
}

@Composable
private fun SeatRow(
    seats: List<Map.Entry<String, Seat>>,
    currentUserId: String,
    currentRole: RoomRole,
    ownerId: String,
    hostIds: Set<String>,
    speakingUserIds: Set<String>,
    seatUsers: Map<String, User>,
    disconnectedUserIds: Set<String>,
    isOwnerAway: Boolean,
    seatSize: Dp,
    requestSeatIndex: Int? = null,
    onSeatClick: (Int) -> Unit,
    onTapUser: (String) -> Unit
) {
    Row(
        modifier = Modifier.fillMaxWidth(),
        horizontalArrangement = Arrangement.SpaceEvenly,
        verticalAlignment = Alignment.CenterVertically
    ) {
        seats.forEach { (indexStr, seat) ->
            key(indexStr) {
                val seatIndex = indexStr.toIntOrNull() ?: return@forEach
                val seatUserId = seat.userId

                val seatRole = remember(seatUserId, ownerId, hostIds) {
                    when {
                        seatUserId == ownerId -> RoomRole.OWNER
                        seatUserId != null && seatUserId in hostIds -> RoomRole.HOST
                        else -> RoomRole.ATTENDEE
                    }
                }

                val isSpeaking = seatUserId != null &&
                    !(seatUserId == currentUserId && seat.isMuted) &&
                    seatUserId in speakingUserIds

                val isDisconnected = (seatUserId != null && seatUserId in disconnectedUserIds)
                    || (isOwnerAway && seatUserId == ownerId)

                val isOwnerOnOwnSeat = seatUserId == currentUserId
                    && seatIndex == Constants.OWNER_SEAT_INDEX
                    && currentRole == RoomRole.OWNER

                val seatUser = seatUserId?.let { seatUsers[it] }

                SeatItem(
                    seatIndex = seatIndex,
                    seat = seat,
                    seatRole = seatRole,
                    isCurrentUser = seatUserId == currentUserId,
                    canLeaveSeat = seatUserId == currentUserId && !isOwnerOnOwnSeat,
                    isSpeaking = isSpeaking && !isDisconnected,
                    isDisconnected = isDisconnected,
                    isRequestSeat = seatIndex == requestSeatIndex,
                    user = seatUser,
                    seatSize = seatSize,
                    onClick = { onSeatClick(seatIndex) },
                    onTapUser = seatUserId?.let { uid -> { onTapUser(uid) } },
                    modifier = Modifier.weight(1f)
                )
            }
        }
    }
}
