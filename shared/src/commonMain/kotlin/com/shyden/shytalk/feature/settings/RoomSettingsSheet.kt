package com.shyden.shytalk.feature.settings

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

@Suppress("kotlin:S3776")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomSettingsSheet(
    roomId: String,
    onDismiss: () -> Unit,
    onCloseRoom: () -> Unit,
    viewModel: RoomSettingsViewModel = koinViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)

    LaunchedEffect(roomId) {
        viewModel.loadRoom(roomId)
    }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(16.dp),
        ) {
            Text(
                text = stringResource(Res.string.room_settings),
                style = MaterialTheme.typography.titleLarge,
                modifier = Modifier.padding(bottom = 16.dp),
            )

            val room = uiState.room
            val isOwner = room != null && viewModel.currentUserId == room.ownerId

            // Lock Seating Toggle (owner only)
            if (isOwner) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = stringResource(Res.string.lock_seating),
                            style = MaterialTheme.typography.bodyLarge,
                        )
                        Text(
                            text = stringResource(Res.string.lock_seating_description),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = uiState.room?.requireApproval ?: false,
                        onCheckedChange = { viewModel.toggleRequireApproval() },
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))
                HorizontalDivider()
                Spacer(modifier = Modifier.height(16.dp))
            }

            // Seat actions (non-owner only)
            if (!isOwner && room != null) {
                val isSeated = room.findUserSeat(viewModel.currentUserId) != null
                if (isSeated) {
                    OutlinedButton(
                        onClick = {
                            viewModel.leaveSeat()
                            onDismiss()
                        },
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        Text(stringResource(Res.string.move_to_audience))
                    }
                } else {
                    val isHost = viewModel.currentUserId in room.hostIds
                    if (isHost || !room.requireApproval) {
                        OutlinedButton(
                            onClick = {
                                viewModel.requestSeat()
                                onDismiss()
                            },
                            modifier = Modifier.fillMaxWidth(),
                        ) {
                            Text(if (isHost) stringResource(Res.string.take_a_seat) else stringResource(Res.string.request_a_seat))
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))
                HorizontalDivider()
                Spacer(modifier = Modifier.height(16.dp))
            }

            // Auto-translate toggle (SuperShy only)
            if (uiState.isSuperShy) {
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Column(modifier = Modifier.weight(1f)) {
                        Text(
                            text = stringResource(Res.string.auto_translate),
                            style = MaterialTheme.typography.bodyLarge,
                        )
                        Text(
                            text = stringResource(Res.string.auto_translate_description),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                    Switch(
                        checked = uiState.autoTranslate,
                        onCheckedChange = { viewModel.toggleAutoTranslate() },
                    )
                }

                Spacer(modifier = Modifier.height(16.dp))
                HorizontalDivider()
                Spacer(modifier = Modifier.height(16.dp))
            }

            // Gift Animations filter (per-user setting)
            var sliderValue by remember(uiState.minGiftAnimationValue) {
                mutableStateOf(uiState.minGiftAnimationValue.toFloat())
            }
            Text(
                text = stringResource(Res.string.gift_animations),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text =
                    if (sliderValue.toInt() == 0) {
                        stringResource(Res.string.showing_all_gift_animations)
                    } else {
                        stringResource(Res.string.showing_animations_worth, sliderValue.toInt())
                    },
                style = MaterialTheme.typography.bodyMedium,
                maxLines = 2,
                overflow = TextOverflow.Ellipsis,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = stringResource(Res.string.filter_gift_animations_description),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(8.dp))
            Slider(
                value = sliderValue,
                onValueChange = { sliderValue = it },
                onValueChangeFinished = { viewModel.setMinGiftAnimationValue(sliderValue.toInt()) },
                valueRange = 0f..10000f,
                modifier = Modifier.padding(horizontal = 24.dp),
            )

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            // Close Room Button (owner only). j09:46 / j15:78 close-room
            // scenarios. Tag aligned with corpus naming (room_endRoomButton
            // not room_closeRoomButton — scenarios prefer the "end" verb).
            if (isOwner) {
                Button(
                    onClick = onCloseRoom,
                    colors =
                        ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.error,
                        ),
                    modifier = Modifier.fillMaxWidth().testTag("room_endRoomButton"),
                ) {
                    Text(stringResource(Res.string.close_room))
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}
