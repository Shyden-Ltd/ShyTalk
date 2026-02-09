package com.shyden.shytalk.feature.room.components

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Constants

@Composable
fun SeatGrid(
    seats: Map<String, Seat>,
    currentUserId: String,
    currentRole: RoomRole,
    ownerId: String,
    hostIds: List<String>,
    speakingUids: Set<Int>,
    seatUsers: Map<String, User> = emptyMap(),
    onSeatClick: (Int) -> Unit,
    onTapUser: (String) -> Unit = {},
    modifier: Modifier = Modifier
) {
    Column(
        modifier = modifier,
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        for (row in 0..1) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceEvenly
            ) {
                for (col in 0..3) {
                    val seatIndex = row * 4 + col
                    val seat = seats[seatIndex.toString()] ?: Seat()
                    val seatUserId = seat.userId

                    val seatRole = when {
                        seatUserId == ownerId -> RoomRole.OWNER
                        seatUserId != null && seatUserId in hostIds -> RoomRole.HOST
                        else -> RoomRole.ATTENDEE
                    }

                    // Check if this seat's user is speaking via Agora UID
                    val isSpeaking = seatUserId != null &&
                        (seatUserId.hashCode() and 0x7FFFFFFF) in speakingUids

                    val isOwnerOnOwnSeat = seat.userId == currentUserId
                        && seatIndex == Constants.OWNER_SEAT_INDEX
                        && currentRole == RoomRole.OWNER

                    val seatUser = seatUserId?.let { seatUsers[it] }

                    SeatItem(
                        seatIndex = seatIndex,
                        seat = seat,
                        seatRole = seatRole,
                        isCurrentUser = seat.userId == currentUserId,
                        canLeaveSeat = seat.userId == currentUserId && !isOwnerOnOwnSeat,
                        isSpeaking = isSpeaking,
                        user = seatUser,
                        onClick = { onSeatClick(seatIndex) },
                        onTapUser = seatUserId?.let { uid -> { onTapUser(uid) } },
                        modifier = Modifier.weight(1f)
                    )
                }
            }
        }
    }
}
