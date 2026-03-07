package com.shyden.shytalk.feature.room.components

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.animation.scaleIn
import androidx.compose.animation.scaleOut
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.widthIn
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.model.SeatRequest
import com.shyden.shytalk.feature.room.RoomNotification
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.*
import org.jetbrains.compose.resources.stringResource

@Composable
fun RoomNotificationOverlay(
    notification: RoomNotification?,
    onApproveSeatRequest: (SeatRequest) -> Unit,
    onDenySeatRequest: (SeatRequest) -> Unit,
    onAcceptApprovedRequest: (SeatRequest) -> Unit,
    onDeclineApprovedRequest: (SeatRequest) -> Unit,
    onAcceptInvite: () -> Unit,
    onDeclineInvite: () -> Unit,
    modifier: Modifier = Modifier
) {
    AnimatedVisibility(
        visible = notification != null,
        enter = fadeIn(tween(200)) + scaleIn(
            initialScale = 0.8f,
            animationSpec = tween(200)
        ),
        exit = fadeOut(tween(150)) + scaleOut(
            targetScale = 0.8f,
            animationSpec = tween(150)
        ),
        modifier = modifier
    ) {
        notification?.let { notif ->
            Card(
                modifier = Modifier
                    .widthIn(max = 320.dp)
                    .padding(24.dp),
                elevation = CardDefaults.cardElevation(defaultElevation = 8.dp),
                colors = CardDefaults.cardColors(
                    containerColor = MaterialTheme.colorScheme.surfaceContainerHigh
                )
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.spacedBy(12.dp)
                ) {
                    when (notif) {
                        is RoomNotification.SeatRequestReceived -> {
                            Text(
                                text = stringResource(Res.string.user_wants_to_sit, notif.request.userName),
                                style = MaterialTheme.typography.bodyLarge,
                                textAlign = TextAlign.Center
                            )
                            Text(
                                text = stringResource(Res.string.seat_number, notif.request.seatIndex + 1),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                OutlinedButton(onClick = { onDenySeatRequest(notif.request) }) {
                                    Text(stringResource(Res.string.deny))
                                }
                                Button(onClick = { onApproveSeatRequest(notif.request) }) {
                                    Text(stringResource(Res.string.accept))
                                }
                            }
                        }
                        is RoomNotification.RequestApproved -> {
                            Text(
                                text = stringResource(Res.string.request_accepted),
                                style = MaterialTheme.typography.bodyLarge,
                                textAlign = TextAlign.Center
                            )
                            Text(
                                text = stringResource(Res.string.seat_number, notif.request.seatIndex + 1),
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                OutlinedButton(onClick = { onDeclineApprovedRequest(notif.request) }) {
                                    Text(stringResource(Res.string.decline))
                                }
                                Button(onClick = { onAcceptApprovedRequest(notif.request) }) {
                                    Text(stringResource(Res.string.go_to_seat))
                                }
                            }
                        }
                        is RoomNotification.InviteReceived -> {
                            Text(
                                text = stringResource(Res.string.invited_to_sit),
                                style = MaterialTheme.typography.bodyLarge,
                                textAlign = TextAlign.Center
                            )
                            Row(horizontalArrangement = Arrangement.spacedBy(12.dp)) {
                                OutlinedButton(onClick = onDeclineInvite) {
                                    Text(stringResource(Res.string.decline))
                                }
                                Button(onClick = onAcceptInvite) {
                                    Text(stringResource(Res.string.accept))
                                }
                            }
                        }
                    }
                }
            }
        }
    }
}
