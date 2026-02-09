package com.shyden.shytalk.feature.room

import android.Manifest
import android.content.pm.PackageManager
import androidx.activity.compose.BackHandler
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.core.tween
import androidx.compose.animation.slideInHorizontally
import androidx.compose.animation.slideOutHorizontally
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.hilt.navigation.compose.hiltViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.launch
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.feature.room.components.ChatPanel
import com.shyden.shytalk.feature.room.components.OwnerAwayBanner
import com.shyden.shytalk.feature.room.components.ParticipantInfo
import com.shyden.shytalk.feature.room.components.ParticipantListPanel
import com.shyden.shytalk.feature.room.components.RoomToolbar
import com.shyden.shytalk.feature.room.components.SeatGrid
import com.shyden.shytalk.feature.room.components.UserCardPopup
import com.shyden.shytalk.feature.settings.RoomSettingsSheet

@Composable
fun RoomScreen(
    roomId: String,
    onNavigateBack: () -> Unit,
    onNavigateToUserProfile: (String) -> Unit = {},
    viewModel: RoomViewModel = hiltViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var showSettings by remember { mutableStateOf(false) }
    var showUserCardForId by remember { mutableStateOf<String?>(null) }
    var showParticipantPanel by remember { mutableStateOf(false) }

    // Audio permission handling
    val context = LocalContext.current
    val scope = rememberCoroutineScope()
    val permissionLauncher = rememberLauncherForActivityResult(
        contract = ActivityResultContracts.RequestPermission()
    ) { granted ->
        viewModel.onAudioPermissionResult(granted)
        if (!granted) {
            scope.launch {
                snackbarHostState.showSnackbar("Microphone permission denied. You won't be able to use voice chat.")
            }
        }
    }

    LaunchedEffect(Unit) {
        val already = ContextCompat.checkSelfPermission(
            context, Manifest.permission.RECORD_AUDIO
        ) == PackageManager.PERMISSION_GRANTED
        if (already) {
            viewModel.onAudioPermissionResult(true)
        } else {
            permissionLauncher.launch(Manifest.permission.RECORD_AUDIO)
        }
    }

    BackHandler(enabled = showParticipantPanel) {
        showParticipantPanel = false
    }

    LaunchedEffect(uiState.roomClosed) {
        if (uiState.roomClosed) {
            onNavigateBack()
        }
    }

    LaunchedEffect(uiState.shouldNavigateBack) {
        if (uiState.shouldNavigateBack) {
            onNavigateBack()
        }
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    // Block warning dialogs
    uiState.blockWarning?.let { warning ->
        when (warning) {
            is BlockWarning.BlockedUserInRoom -> {
                AlertDialog(
                    onDismissRequest = {},
                    title = { Text("Blocked User in Room") },
                    text = {
                        Text("A user you have blocked is in this room. They will be able to communicate with you. Enter anyway?")
                    },
                    confirmButton = {
                        TextButton(onClick = { viewModel.confirmJoinDespiteBlock() }) {
                            Text("Enter")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { onNavigateBack() }) {
                            Text("Choose Another Room")
                        }
                    }
                )
            }
            is BlockWarning.BlockedByUserInRoom -> {
                AlertDialog(
                    onDismissRequest = {},
                    title = { Text("Notice") },
                    text = {
                        Text("A user in this room has blocked you. You may have a limited experience. Enter anyway?")
                    },
                    confirmButton = {
                        TextButton(onClick = { viewModel.confirmJoinDespiteBlock() }) {
                            Text("Enter")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { onNavigateBack() }) {
                            Text("Choose Another Room")
                        }
                    }
                )
            }
        }
    }

    // Compute participant lists for the panel
    val room = uiState.room
    val voiceUsers: List<ParticipantInfo>
    val audienceUsers: List<ParticipantInfo>

    if (room != null) {
        val seatedUserIds = room.seats.values
            .filter { it.state == SeatState.OCCUPIED && it.userId != null }
            .mapNotNull { it.userId }
            .toSet()

        val allUsers = uiState.participantUsers

        voiceUsers = seatedUserIds.mapNotNull { uid ->
            allUsers[uid]?.let { user ->
                val role = when {
                    uid == room.ownerId -> RoomRole.OWNER
                    uid in room.hostIds -> RoomRole.HOST
                    else -> RoomRole.ATTENDEE
                }
                val seat = room.seats.values.find { it.userId == uid }
                ParticipantInfo(user, role, isMuted = seat?.isMuted ?: false)
            }
        }.sortedWith(
            compareBy<ParticipantInfo> { it.role.ordinal }
                .thenBy { it.user.displayName.lowercase() }
        )

        audienceUsers = room.participantIds
            .filter { it !in seatedUserIds }
            .mapNotNull { uid ->
                allUsers[uid]?.let { user ->
                    val role = when {
                        uid == room.ownerId -> RoomRole.OWNER
                        uid in room.hostIds -> RoomRole.HOST
                        else -> RoomRole.ATTENDEE
                    }
                    ParticipantInfo(user, role)
                }
            }
            .sortedWith(
                compareBy<ParticipantInfo> { it.role.ordinal }
                    .thenBy { it.user.displayName.lowercase() }
            )
    } else {
        voiceUsers = emptyList()
        audienceUsers = emptyList()
    }

    // Merged user map for ChatPanel
    val userMap = uiState.seatUsers + uiState.participantUsers

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            RoomToolbar(
                roomName = uiState.room?.name ?: "Room",
                participantCount = uiState.room?.participantIds?.size ?: 0,
                isOwnerOrHost = uiState.currentRole == RoomRole.OWNER || uiState.currentRole == RoomRole.HOST,
                onBack = {
                    viewModel.leaveRoom()
                    onNavigateBack()
                },
                onSettings = { showSettings = true },
                onTogglePeople = { showParticipantPanel = !showParticipantPanel }
            )
        }
    ) { padding ->
        Box(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            if (uiState.isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else if (!uiState.hasJoined && uiState.blockWarning == null) {
                // Loading state while block check is in progress
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else if (uiState.hasJoined) {
                Column(modifier = Modifier.fillMaxSize()) {
                    // Owner Away Banner
                    if (uiState.room?.state == RoomState.OWNER_AWAY) {
                        OwnerAwayBanner(
                            remainingMs = uiState.ownerAwayRemainingMs,
                            isOwner = uiState.currentRole == RoomRole.OWNER,
                            onOwnerReturn = { viewModel.ownerReturn() }
                        )
                    }

                    // Invite Banner
                    if (uiState.pendingInvite != null) {
                        Card(
                            modifier = Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 16.dp, vertical = 8.dp),
                            colors = CardDefaults.cardColors(
                                containerColor = MaterialTheme.colorScheme.secondaryContainer
                            )
                        ) {
                            Row(
                                modifier = Modifier
                                    .fillMaxWidth()
                                    .padding(12.dp),
                                horizontalArrangement = Arrangement.SpaceBetween,
                                verticalAlignment = Alignment.CenterVertically
                            ) {
                                Text(
                                    text = "You've been invited to sit",
                                    style = MaterialTheme.typography.bodyMedium,
                                    modifier = Modifier.weight(1f)
                                )
                                Row(horizontalArrangement = Arrangement.spacedBy(8.dp)) {
                                    OutlinedButton(onClick = { viewModel.declineInvite() }) {
                                        Text("Decline")
                                    }
                                    Button(onClick = { viewModel.acceptInvite() }) {
                                        Text("Accept")
                                    }
                                }
                            }
                        }
                    }

                    // Seat Grid (upper portion)
                    SeatGrid(
                        seats = uiState.room?.seats ?: emptyMap(),
                        currentUserId = uiState.currentUserId,
                        currentRole = uiState.currentRole,
                        ownerId = uiState.room?.ownerId ?: "",
                        hostIds = uiState.room?.hostIds ?: emptyList(),
                        speakingUids = uiState.speakingUids,
                        seatUsers = uiState.seatUsers,
                        onSeatClick = { seatIndex ->
                            val seat = uiState.room?.seats?.get(seatIndex.toString())
                            if (seat?.userId == uiState.currentUserId) {
                                viewModel.leaveSeat(seatIndex)
                            } else if (seat?.userId == null) {
                                viewModel.takeSeat(seatIndex)
                            }
                        },
                        onRemoveFromSeat = { seatIndex ->
                            viewModel.removeFromSeat(seatIndex)
                        },
                        onToggleSelfMute = { seatIndex ->
                            viewModel.toggleSelfMute(seatIndex)
                        },
                        onForceMute = { seatIndex ->
                            viewModel.forceMuteUser(seatIndex)
                        },
                        onKickUser = { seatIndex ->
                            viewModel.kickUser(seatIndex)
                        },
                        onMoveSeat = { fromIndex, toIndex ->
                            viewModel.moveSeat(fromIndex, toIndex)
                        },
                        onTapUser = { userId ->
                            showUserCardForId = userId
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .padding(16.dp)
                    )

                    HorizontalDivider()

                    // Chat Panel (lower portion)
                    ChatPanel(
                        messages = uiState.messages,
                        currentUserId = uiState.currentUserId,
                        currentRole = uiState.currentRole,
                        seats = uiState.room?.seats ?: emptyMap(),
                        userMap = userMap,
                        onToggleMic = { seatIndex -> viewModel.toggleSelfMute(seatIndex) },
                        onSendMessage = { viewModel.sendMessage(it) },
                        onTapUser = { userId ->
                            showUserCardForId = userId
                        },
                        onInviteUser = { senderId, senderName ->
                            viewModel.inviteFromMessage(senderId, senderName)
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                    )
                }
            }

            // Scrim overlay
            if (showParticipantPanel) {
                Box(
                    modifier = Modifier
                        .fillMaxSize()
                        .background(Color.Black.copy(alpha = 0.4f))
                        .clickable(
                            indication = null,
                            interactionSource = remember { MutableInteractionSource() }
                        ) { showParticipantPanel = false }
                )
            }

            // Sliding participant panel from right
            AnimatedVisibility(
                visible = showParticipantPanel,
                enter = slideInHorizontally(
                    initialOffsetX = { fullWidth -> fullWidth },
                    animationSpec = tween(300)
                ),
                exit = slideOutHorizontally(
                    targetOffsetX = { fullWidth -> fullWidth },
                    animationSpec = tween(300)
                ),
                modifier = Modifier.align(Alignment.CenterEnd)
            ) {
                ParticipantListPanel(
                    voiceUsers = voiceUsers,
                    audienceUsers = audienceUsers,
                    onUserClick = { userId ->
                        showParticipantPanel = false
                        showUserCardForId = userId
                    },
                    onDismiss = { showParticipantPanel = false },
                    modifier = Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(0.7f)
                )
            }
        }

        if (showSettings && uiState.room != null) {
            RoomSettingsSheet(
                roomId = roomId,
                onDismiss = { showSettings = false },
                onCloseRoom = {
                    showSettings = false
                    viewModel.closeRoom()
                }
            )
        }

        // User card popup when tapping a user
        showUserCardForId?.let { userId ->
            val user = uiState.seatUsers[userId] ?: uiState.participantUsers[userId]
            if (user != null) {
                val canInviteFromCard = (uiState.currentRole == RoomRole.OWNER || uiState.currentRole == RoomRole.HOST)
                        && userId != uiState.currentUserId
                        && uiState.room?.seats?.values?.none { it.userId == userId && it.state == SeatState.OCCUPIED } == true
                UserCardPopup(
                    user = user,
                    isBlocked = userId in uiState.blockedUserIds,
                    isSelf = userId == uiState.currentUserId,
                    onViewProfile = {
                        showUserCardForId = null
                        onNavigateToUserProfile(userId)
                    },
                    onBlock = {
                        viewModel.blockUser(userId)
                        showUserCardForId = null
                    },
                    onUnblock = {
                        viewModel.unblockUser(userId)
                        showUserCardForId = null
                    },
                    onInvite = if (canInviteFromCard) {
                        {
                            viewModel.inviteFromMessage(userId, user.displayName)
                            showUserCardForId = null
                        }
                    } else null,
                    onDismiss = { showUserCardForId = null }
                )
            }
        }
    }
}
