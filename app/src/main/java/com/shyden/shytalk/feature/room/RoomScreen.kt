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
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Surface
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
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
import com.shyden.shytalk.ui.components.CnyRoomBackground
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.launch
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.feature.room.components.ChatPanel
import com.shyden.shytalk.feature.room.components.OwnerAwayBanner
import com.shyden.shytalk.feature.room.components.ParticipantInfo
import com.shyden.shytalk.feature.room.components.ParticipantListPanel
import com.shyden.shytalk.feature.room.components.RoomClosedSummaryPanel
import com.shyden.shytalk.feature.room.components.RoomNotificationOverlay
import com.shyden.shytalk.feature.room.components.SeatActionFeedback
import com.shyden.shytalk.feature.room.components.RoomToolbar
import com.shyden.shytalk.feature.room.components.SeatGrid
import com.shyden.shytalk.feature.room.components.UserCardPopup
import androidx.activity.result.PickVisualMediaRequest
import com.shyden.shytalk.core.model.Broadcast
import com.shyden.shytalk.core.ui.BroadcastBanner
import com.shyden.shytalk.core.ui.GiftEffectOverlay
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.feature.gacha.GachaViewModel
import com.shyden.shytalk.feature.gacha.LuckySpinOverlay
import com.shyden.shytalk.feature.gifting.GiftingViewModel
import com.shyden.shytalk.feature.messaging.ConversationListViewModel
import com.shyden.shytalk.feature.messaging.PmBottomSheet
import com.shyden.shytalk.feature.messaging.PrivateChatViewModel
import com.shyden.shytalk.feature.room.components.BackpackSheet
import com.shyden.shytalk.feature.room.components.RoomActionCarousel
import com.shyden.shytalk.feature.daily.DailyRewardDialog
import com.shyden.shytalk.feature.daily.DailyRewardViewModel
import com.shyden.shytalk.feature.settings.RoomSettingsSheet
import org.koin.compose.koinInject

@Composable
fun RoomScreen(
    roomId: String,
    onNavigateBack: () -> Unit,
    onNavigateToUserProfile: (String) -> Unit = {},
    onNavigateToChat: (String) -> Unit = {},
    viewModel: RoomViewModel = koinViewModel { parametersOf(roomId) }
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val conversationListViewModel: ConversationListViewModel = koinInject()
    val convListState by conversationListViewModel.uiState.collectAsStateWithLifecycle()
    val gachaViewModel: GachaViewModel = koinInject()
    val giftingViewModel: GiftingViewModel = koinInject()
    val dailyRewardViewModel: DailyRewardViewModel = koinInject()
    val giftRepository: GiftRepository = koinInject()
    val gachaState by gachaViewModel.uiState.collectAsStateWithLifecycle()
    val giftingState by giftingViewModel.uiState.collectAsStateWithLifecycle()
    var latestBroadcast by remember { mutableStateOf<Broadcast?>(null) }
    val snackbarHostState = remember { SnackbarHostState() }
    var showSettings by remember(roomId) { mutableStateOf(false) }
    var showUserCardForId by remember(roomId) { mutableStateOf<String?>(null) }
    var showParticipantPanel by remember(roomId) { mutableStateOf(false) }
    var showRoomNameDialog by remember(roomId) { mutableStateOf(false) }
    var showPmSheet by remember(roomId) { mutableStateOf(false) }
    var pmSheetPreOpenUserId by remember(roomId) { mutableStateOf<String?>(null) }
    var showGachaWheel by remember(roomId) { mutableStateOf(false) }
    var showDailyReward by remember(roomId) { mutableStateOf(false) }
    var showBackpackSheet by remember(roomId) { mutableStateOf(false) }
    var backpackRecipientId by remember(roomId) { mutableStateOf("") }
    var backpackRecipientName by remember(roomId) { mutableStateOf("") }
    var showGiftEffect by remember { mutableStateOf(false) }
    var giftEffectAnimUrl by remember { mutableStateOf("") }
    var giftEffectSoundUrl by remember { mutableStateOf("") }
    var pmImageResultHandler by remember { mutableStateOf<((List<ByteArray>) -> Unit)?>(null) }
    var pmStickerResultHandler by remember { mutableStateOf<((ByteArray) -> Unit)?>(null) }
    val reportEvidenceList = remember { mutableListOf<Pair<ByteArray, String>>() }
    var reportEvidenceVersion by remember { mutableStateOf(0) }
    var isCompressingEvidence by remember { mutableStateOf(false) }

    val context = LocalContext.current
    val evidenceScope = rememberCoroutineScope()

    val reportEvidencePickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        if (uri != null) {
            val mimeType = context.contentResolver.getType(uri) ?: "image/jpeg"
            if (mimeType.startsWith("video/")) {
                isCompressingEvidence = true
                evidenceScope.launch {
                    val result = com.shyden.shytalk.core.util.VideoCompressor.compressVideo(
                        context, uri, Constants.EVIDENCE_VIDEO_TARGET_BYTES, mimeType
                    )
                    isCompressingEvidence = false
                    if (result != null && result.first.size <= Constants.EVIDENCE_MAX_SIZE_BYTES) {
                        reportEvidenceList.add(result)
                        reportEvidenceVersion++
                    } else {
                        snackbarHostState.showSnackbar("Video is too large to upload. Please use a shorter clip.")
                    }
                }
            } else {
                val bytes = context.contentResolver.openInputStream(uri)?.readBytes()
                if (bytes != null) {
                    if (bytes.size <= Constants.EVIDENCE_MAX_SIZE_BYTES) {
                        reportEvidenceList.add(bytes to mimeType)
                        reportEvidenceVersion++
                    } else {
                        evidenceScope.launch {
                            snackbarHostState.showSnackbar("File is too large. Maximum size is 10 MB.")
                        }
                    }
                }
            }
        }
    }

    val pmImagePickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickMultipleVisualMedia(10)
    ) { uris ->
        if (uris.isNotEmpty()) {
            val bytesList = uris.mapNotNull { uri ->
                context.contentResolver.openInputStream(uri)?.readBytes()
            }
            pmImageResultHandler?.invoke(bytesList)
        }
    }

    val pmStickerPickerLauncher = rememberLauncherForActivityResult(
        ActivityResultContracts.PickVisualMedia()
    ) { uri ->
        if (uri != null) {
            val bytes = context.contentResolver.openInputStream(uri)?.readBytes()
            if (bytes != null) {
                pmStickerResultHandler?.invoke(bytes)
            }
        }
    }

    val currentUser = uiState.allKnownUsers[uiState.currentUserId]

    // Observe broadcasts
    LaunchedEffect(Unit) {
        giftRepository.observeBroadcasts()
            .catch { /* ignore errors */ }
            .collect { broadcasts ->
                latestBroadcast = broadcasts.firstOrNull()
            }
    }

    // Handle gift sending success - trigger effect
    LaunchedEffect(giftingState.sentGiftId) {
        val giftId = giftingState.sentGiftId ?: return@LaunchedEffect
        val gift = giftingState.giftCatalog.find { it.id == giftId }
        if (gift != null) {
            giftEffectAnimUrl = gift.animationUrl ?: ""
            giftEffectSoundUrl = gift.soundUrl ?: ""
            showGiftEffect = giftEffectAnimUrl.isNotBlank()
            showBackpackSheet = false
        }
        giftingViewModel.clearSentGift()
    }

    // Handle gacha win — trigger GiftEffectOverlay for RARE+ single wins
    LaunchedEffect(gachaState.currentWin) {
        val win = gachaState.currentWin ?: return@LaunchedEffect
        if (win.bracket.ordinal >= com.shyden.shytalk.core.model.GiftBracket.RARE.ordinal) {
            val gift = gachaState.giftCatalog.find { it.id == win.giftId }
            if (gift != null && gift.animationUrl.isNotBlank()) {
                // Delay so the wheel celebration finishes first
                kotlinx.coroutines.delay(2600)
                giftEffectAnimUrl = gift.animationUrl
                giftEffectSoundUrl = gift.soundUrl
                showGiftEffect = true
            }
        }
    }

    // Handle gacha errors
    LaunchedEffect(gachaState.error) {
        gachaState.error?.let {
            snackbarHostState.showSnackbar(it)
            gachaViewModel.clearError()
        }
    }

    // Handle gifting errors
    LaunchedEffect(giftingState.error) {
        giftingState.error?.let {
            snackbarHostState.showSnackbar(it)
            giftingViewModel.clearError()
        }
    }

    // Track room screen visibility for chathead
    DisposableEffect(Unit) {
        viewModel.setRoomScreenVisible(true)
        onDispose { viewModel.setRoomScreenVisible(false) }
    }

    // Audio permission handling
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

    // System back navigates back without leaving the room (voice persists)
    BackHandler(enabled = !showParticipantPanel && uiState.hasJoined) {
        onNavigateBack()
    }

    BackHandler(enabled = showParticipantPanel) {
        showParticipantPanel = false
    }

    // Show kicked dialog
    if (uiState.wasKicked) {
        AlertDialog(
            onDismissRequest = {},
            title = { Text("Removed from Room") },
            text = {
                Column {
                    if (uiState.kickedByName != null) {
                        Text("You were kicked by ${uiState.kickedByName}.")
                    } else {
                        Text("You have been kicked from this room.")
                    }
                    if (uiState.kickReason != null) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = "Reason: ${uiState.kickReason}",
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { onNavigateBack() }) {
                    Text("OK")
                }
            }
        )
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

    LaunchedEffect(uiState.seatActionStatus) {
        val status = uiState.seatActionStatus
        if (status is SeatActionStatus.Success) {
            snackbarHostState.showSnackbar(status.message)
        }
    }

    LaunchedEffect(uiState.reportSubmitted) {
        if (uiState.reportSubmitted) {
            showUserCardForId = null
            reportEvidenceList.clear()
            reportEvidenceVersion++
            snackbarHostState.showSnackbar("Thank you for your report. We will review it shortly.")
            viewModel.clearReportSubmitted()
        }
    }

    if (uiState.seatActionStatus is SeatActionStatus.Loading) {
        SeatActionFeedback(message = (uiState.seatActionStatus as SeatActionStatus.Loading).message)
    }

    // Block warning dialogs
    uiState.blockWarning?.let { warning ->
        val (title, message, showEnterOption) = when (warning) {
            is BlockWarning.Banned -> {
                val reason = buildString {
                    append("You were banned from this room.")
                    if (warning.kickerName != null) {
                        append("\nBanned by: ${warning.kickerName}")
                    }
                    if (!warning.reason.isNullOrBlank()) {
                        append("\nReason: ${warning.reason}")
                    }
                }
                Triple("Banned from Room", reason, false)
            }
            is BlockWarning.BlockedByRoomOwner -> Triple(
                "Cannot Enter Room",
                "You are not allowed to enter this room.",
                false
            )
            is BlockWarning.BlockedUserInRoom -> Triple(
                "Blocked User in Room",
                "A user you have blocked is in this room. They will be able to communicate with you. Enter anyway?",
                true
            )
            is BlockWarning.BlockedByUserInRoom -> Triple(
                "Notice",
                "A user in this room has blocked you. You may have a limited experience. Enter anyway?",
                true
            )
        }
        AlertDialog(
            onDismissRequest = {},
            title = { Text(title) },
            text = { Text(message) },
            confirmButton = {
                TextButton(onClick = {
                    if (showEnterOption) viewModel.confirmJoinDespiteBlock() else onNavigateBack()
                }) {
                    Text(if (showEnterOption) "Enter" else "Go Back")
                }
            },
            dismissButton = if (showEnterOption) {
                {
                    TextButton(onClick = { onNavigateBack() }) {
                        Text("Choose Another Room")
                    }
                }
            } else null
        )
    }

    // Compute participant lists for the panel (memoized to avoid recomposition waste)
    val room = uiState.room
    val participantUsers = uiState.participantUsers

    val seatedUserIds = remember(room) {
        room?.seats?.values
            ?.filter { it.state == SeatState.OCCUPIED && it.userId != null }
            ?.mapNotNull { it.userId }
            ?.toSet() ?: emptySet()
    }

    val voiceUsers by remember(room, participantUsers, seatedUserIds) {
        derivedStateOf {
            val r = room ?: return@derivedStateOf emptyList<ParticipantInfo>()
            seatedUserIds.mapNotNull { uid ->
                participantUsers[uid]?.let { user ->
                    val seat = r.findUserSeat(uid)?.value
                    ParticipantInfo(user, r.resolveRole(uid), isMuted = seat?.isMuted ?: false)
                }
            }.sortedWith(
                compareBy<ParticipantInfo> { it.role.ordinal }
                    .thenBy { it.user.displayName.lowercase() }
            )
        }
    }

    val audienceUsers by remember(room, participantUsers, seatedUserIds) {
        derivedStateOf {
            val r = room ?: return@derivedStateOf emptyList<ParticipantInfo>()
            r.participantIds
                .filter { it !in seatedUserIds }
                .mapNotNull { uid ->
                    participantUsers[uid]?.let { user ->
                        ParticipantInfo(user, r.resolveRole(uid))
                    }
                }
                .sortedWith(
                    compareBy<ParticipantInfo> { it.role.ordinal }
                        .thenBy { it.user.displayName.lowercase() }
                )
        }
    }

    val isOwnerOrHost by remember {
        derivedStateOf {
            uiState.currentRole == RoomRole.OWNER || uiState.currentRole == RoomRole.HOST
        }
    }

    // Merged user map for ChatPanel — use allKnownUsers so departed users keep their avatars
    val userMap = remember(uiState.allKnownUsers) {
        uiState.allKnownUsers
    }

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(MaterialTheme.colorScheme.background)
    ) {
        // Animated CNY Canvas background
        CnyRoomBackground(modifier = Modifier.fillMaxSize())

        Scaffold(
            containerColor = Color.Transparent,
            snackbarHost = {
                SnackbarHost(
                    hostState = snackbarHostState,
                    modifier = Modifier.padding(bottom = 56.dp),
                    snackbar = { data ->
                        Surface(
                            shape = MaterialTheme.shapes.small,
                            color = MaterialTheme.colorScheme.inverseSurface.copy(alpha = 0.75f),
                            modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp)
                        ) {
                            Text(
                                text = data.visuals.message,
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.inverseOnSurface,
                                modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp)
                            )
                        }
                    }
                )
            },
            topBar = {
                if (!uiState.roomClosed) {
                    RoomToolbar(
                        roomName = uiState.room?.name ?: "Room",
                        participantCount = uiState.room?.participantIds?.size ?: 0,
                        roomExpiryRemainingMs = uiState.roomExpiryRemainingMs,
                        onBack = { onNavigateBack() },
                        onTogglePeople = { showParticipantPanel = !showParticipantPanel },
                        onRoomNameClick = { showRoomNameDialog = true },
                        onSettings = { showSettings = true }
                    )
                }
            }
        ) { padding ->
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .padding(padding)
            ) {
                val closedSummary = uiState.roomClosedSummary
            if (uiState.roomClosed && closedSummary != null) {
                RoomClosedSummaryPanel(
                    summary = closedSummary,
                    onDismiss = onNavigateBack
                )
            } else if (uiState.roomClosed) {
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Text(
                        text = "Room Closed",
                        style = MaterialTheme.typography.headlineMedium
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "This room is no longer available.",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                    Spacer(modifier = Modifier.height(24.dp))
                    Button(onClick = onNavigateBack) {
                        Text("Back to Home")
                    }
                }
            } else if (uiState.isLoading) {
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
            } else if (uiState.hasJoined && !uiState.isVoiceReady) {
                // Loading screen while connecting to voice
                Column(
                    modifier = Modifier.fillMaxSize(),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center
                ) {
                    Text(
                        text = uiState.room?.name ?: "Room",
                        style = MaterialTheme.typography.headlineSmall,
                        color = MaterialTheme.colorScheme.onBackground
                    )
                    Spacer(modifier = Modifier.height(24.dp))
                    CircularProgressIndicator()
                    Spacer(modifier = Modifier.height(16.dp))
                    Text(
                        text = "Connecting...",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else if (uiState.hasJoined) {
                Column(modifier = Modifier.fillMaxSize()) {
                    // Owner Away Banner
                    if (uiState.room?.state == RoomState.OWNER_AWAY) {
                        OwnerAwayBanner(
                            remainingMs = uiState.ownerAwayRemainingMs
                        )
                    }

                    // Seat Grid (upper portion — only occupied seats)
                    val isCurrentUserSeated = uiState.currentUserId in seatedUserIds
                    val showRequestSeat = !isCurrentUserSeated
                        && uiState.room?.requireApproval != true

                    SeatGrid(
                        seats = uiState.room?.seats ?: emptyMap(),
                        currentUserId = uiState.currentUserId,
                        currentRole = uiState.currentRole,
                        ownerId = uiState.room?.ownerId ?: "",
                        hostIds = uiState.room?.hostIds ?: emptySet(),
                        speakingUserIds = uiState.speakingUserIds,
                        seatUsers = uiState.seatUsers,
                        disconnectedUserIds = uiState.disconnectedUserIds,
                        isOwnerAway = uiState.room?.state == RoomState.OWNER_AWAY,
                        showRequestSeat = showRequestSeat,
                        onSeatClick = { seatIndex ->
                            val seat = uiState.room?.seats?.get(seatIndex.toString())
                            if (seat?.userId == uiState.currentUserId) {
                                viewModel.leaveSeat(seatIndex)
                            } else if (seat?.userId == null) {
                                viewModel.takeSeat(seatIndex)
                            }
                        },
                        onTapUser = { userId ->
                            showUserCardForId = userId
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .padding(horizontal = 12.dp, vertical = 8.dp)
                    )

                    // Chat Panel (lower portion)
                    ChatPanel(
                        messages = uiState.messages,
                        currentUserId = uiState.currentUserId,
                        currentRole = uiState.currentRole,
                        seats = uiState.room?.seats ?: emptyMap(),
                        userMap = userMap,
                        isOwnerOrHost = isOwnerOrHost,
                        onToggleMic = { seatIndex -> viewModel.toggleSelfMute(seatIndex) },
                        onSendMessage = { viewModel.sendMessage(it) },
                        onTapUser = { userId ->
                            showUserCardForId = userId
                        },
                        onInviteUser = { senderId, senderName ->
                            viewModel.inviteFromMessage(senderId, senderName)
                        },
                        onToggleMessages = {
                            pmSheetPreOpenUserId = null
                            showPmSheet = true
                        },
                        unreadCount = convListState.totalUnreadCount.toInt(),
                        onOpenBackpack = {
                            backpackRecipientId = uiState.currentUserId
                            backpackRecipientName = ""
                            showBackpackSheet = true
                        },
                        modifier = Modifier
                            .fillMaxWidth()
                            .weight(1f)
                    )
                }
            }

            // Center-screen notification overlay
            RoomNotificationOverlay(
                notification = uiState.activeNotification,
                onApproveSeatRequest = { viewModel.approveRequestFromNotification(it) },
                onDenySeatRequest = { viewModel.denyRequestFromNotification(it) },
                onAcceptApprovedRequest = { viewModel.acceptApprovedRequest(it) },
                onDeclineApprovedRequest = { viewModel.declineApprovedRequest(it) },
                onAcceptInvite = { viewModel.acceptInvite() },
                onDeclineInvite = { viewModel.declineInvite() },
                modifier = Modifier.align(Alignment.Center)
            )

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
                    pendingRequests = uiState.pendingRequestsForPanel,
                    pendingInviteUserIds = uiState.room?.pendingInvites?.keys ?: emptySet(),
                    seatedUserIds = seatedUserIds,
                    isOwnerOrHost = isOwnerOrHost,
                    onUserClick = { userId ->
                        showParticipantPanel = false
                        showUserCardForId = userId
                    },
                    onApproveRequest = { viewModel.approveRequestFromNotification(it) },
                    onDenyRequest = { viewModel.denyRequestFromNotification(it) },
                    onInviteUser = { userId, userName ->
                        viewModel.inviteUser(userId, userName)
                    },
                    onDismiss = { showParticipantPanel = false },
                    modifier = Modifier
                        .fillMaxHeight()
                        .fillMaxWidth(0.7f)
                )
            }

            // Floating action carousel (bottom-right, inside scaffold content to respect padding)
            if (uiState.hasJoined && !uiState.roomClosed) {
                RoomActionCarousel(
                    onOpenGacha = { showGachaWheel = true },
                    onOpenDailyReward = { showDailyReward = true },
                    modifier = Modifier
                        .align(Alignment.BottomEnd)
                        .padding(bottom = 64.dp, end = 8.dp)
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

        if (showRoomNameDialog && uiState.room != null) {
            val isOwner = uiState.currentRole == RoomRole.OWNER
            if (isOwner) {
                var editedName by remember(showRoomNameDialog) { mutableStateOf(uiState.room?.name ?: "") }
                AlertDialog(
                    onDismissRequest = { showRoomNameDialog = false },
                    title = { Text("Edit Room Name") },
                    text = {
                        OutlinedTextField(
                            value = editedName,
                            onValueChange = { if (it.length <= 50) editedName = it },
                            singleLine = true,
                            placeholder = { Text("Room name") }
                        )
                    },
                    confirmButton = {
                        TextButton(
                            onClick = {
                                viewModel.updateRoomName(editedName.trim())
                                showRoomNameDialog = false
                            },
                            enabled = editedName.isNotBlank()
                        ) {
                            Text("Save")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { showRoomNameDialog = false }) {
                            Text("Cancel")
                        }
                    }
                )
            } else {
                AlertDialog(
                    onDismissRequest = { showRoomNameDialog = false },
                    title = { Text("Room Name") },
                    text = {
                        Text(
                            text = uiState.room?.name ?: "",
                            style = MaterialTheme.typography.bodyLarge
                        )
                    },
                    confirmButton = {
                        TextButton(onClick = { showRoomNameDialog = false }) {
                            Text("Close")
                        }
                    }
                )
            }
        }

        // User card popup when tapping a user
        showUserCardForId?.let { userId ->
            val movableSeats = remember(uiState.room?.seats, userId) {
                uiState.room?.seats?.entries
                    ?.filter { it.key.toInt() != Constants.OWNER_SEAT_INDEX && it.value.userId != userId }
                    ?.map { it.key.toInt() } ?: emptyList()
            }
            val user = uiState.seatUsers[userId] ?: uiState.participantUsers[userId] ?: uiState.allKnownUsers[userId]
            if (user != null) {
                val targetSeatEntry = uiState.room?.findUserSeat(userId)
                val isTargetSeated = targetSeatEntry != null
                val targetSeatIndex = targetSeatEntry?.key?.toIntOrNull()

                val targetRole = uiState.room?.resolveRole(userId) ?: RoomRole.ATTENDEE

                val isInRoom = userId in (uiState.room?.participantIds ?: emptyList())
                val canInviteFromCard = (uiState.currentRole == RoomRole.OWNER || uiState.currentRole == RoomRole.HOST)
                        && userId != uiState.currentUserId
                        && isInRoom
                        && !isTargetSeated
                        && userId !in (uiState.room?.pendingInvites?.keys ?: emptySet())

                // Mod capabilities: owner can act on hosts + attendees; hosts can act on attendees only
                val isNotSelf = userId != uiState.currentUserId
                val isOwner = uiState.currentRole == RoomRole.OWNER
                val isHostOrOwner = isOwner || uiState.currentRole == RoomRole.HOST
                val canModerate = isNotSelf && isTargetSeated && isHostOrOwner
                    && (isOwner || targetRole == RoomRole.ATTENDEE)
                    && userId != uiState.room?.ownerId
                // Kick is allowed even for unseated users
                val canKick = isNotSelf && isHostOrOwner
                    && (isOwner || targetRole == RoomRole.ATTENDEE)
                    && userId != uiState.room?.ownerId

                UserCardPopup(
                    user = user,
                    isBlocked = userId in uiState.blockedUserIds,
                    isSelf = userId == uiState.currentUserId,
                    onViewProfile = {
                        showUserCardForId = null
                        onNavigateToUserProfile(userId)
                    },
                    onMessage = if (userId != uiState.currentUserId) {
                        {
                            showUserCardForId = null
                            pmSheetPreOpenUserId = userId
                            showPmSheet = true
                        }
                    } else null,
                    onSendGift = if (userId != uiState.currentUserId) {
                        {
                            showUserCardForId = null
                            backpackRecipientId = userId
                            backpackRecipientName = user.displayName
                            showBackpackSheet = true
                        }
                    } else null,
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
                    onMuteToggle = if (canModerate && targetSeatIndex != null
                        && targetSeatEntry?.value?.isMuted != true) {
                        { viewModel.forceMuteUser(targetSeatIndex) }
                    } else null,
                    isTargetMuted = targetSeatEntry?.value?.isMuted ?: false,
                    onRemoveFromSeat = if (canModerate && targetSeatIndex != null
                        && targetSeatIndex != Constants.OWNER_SEAT_INDEX) {
                        { viewModel.removeFromSeat(targetSeatIndex) }
                    } else null,
                    onKickFromRoom = if (canKick) {
                        { reason -> viewModel.kickUser(userId, targetSeatIndex, reason) }
                    } else null,
                    onMoveSeat = if (canModerate && targetSeatIndex != null && movableSeats.isNotEmpty()
                        && targetSeatIndex != Constants.OWNER_SEAT_INDEX) {
                        { toIndex -> viewModel.moveSeat(targetSeatIndex, toIndex) }
                    } else null,
                    emptySeats = movableSeats,
                    seatOccupantNames = remember(uiState.room?.seats, uiState.seatUsers) {
                        uiState.room?.seats?.entries
                            ?.filter { it.value.state == SeatState.OCCUPIED && it.value.userId != null }
                            ?.associate { (key, seat) ->
                                key.toInt() to (uiState.seatUsers[seat.userId]?.displayName ?: "User")
                            } ?: emptyMap()
                    },
                    onMakeHost = if (isOwner && isNotSelf && isTargetSeated
                        && targetRole == RoomRole.ATTENDEE) {
                        { viewModel.addHost(userId) }
                    } else null,
                    onRemoveHost = if (isOwner && isNotSelf && targetRole == RoomRole.HOST) {
                        { viewModel.removeHost(userId) }
                    } else null,
                    isHost = targetRole == RoomRole.HOST,
                    onReportUser = if (userId != uiState.currentUserId) {
                        { reason, description ->
                            viewModel.reportUser(userId, reason, description, reportEvidenceList.toList())
                        }
                    } else null,
                    evidenceItems = reportEvidenceList.map { it.first }.also { _ -> reportEvidenceVersion },
                    onAddEvidence = {
                        reportEvidencePickerLauncher.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo)
                        )
                    },
                    onRemoveEvidence = { index ->
                        if (index in reportEvidenceList.indices) {
                            reportEvidenceList.removeAt(index)
                            reportEvidenceVersion++
                        }
                    },
                    isSubmittingReport = uiState.isSubmittingReport,
                    isCompressingEvidence = isCompressingEvidence,
                    reportError = uiState.reportError,
                    onDismiss = {
                        showUserCardForId = null
                        reportEvidenceList.clear()
                        reportEvidenceVersion++
                    }
                )
            }
        }

        // PM Bottom Sheet
        if (showPmSheet) {
            PmBottomSheet(
                onDismiss = {
                    showPmSheet = false
                    pmSheetPreOpenUserId = null
                },
                preOpenUserId = pmSheetPreOpenUserId,
                onPickImages = { vm ->
                    pmImageResultHandler = { bytesList -> vm.uploadAndSendImages(bytesList) }
                    pmImagePickerLauncher.launch(
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                    )
                },
                onPickStickerImage = { vm ->
                    pmStickerResultHandler = { bytes -> vm.addStickerFromImage(bytes) }
                    pmStickerPickerLauncher.launch(
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                    )
                },
                activeRoomId = roomId,
                activeRoomName = uiState.room?.name
            )
        }

        // Backpack Sheet for sending/viewing gifts
        if (showBackpackSheet) {
            BackpackSheet(
                viewModel = giftingViewModel,
                recipientId = backpackRecipientId,
                recipientName = backpackRecipientName,
                currentUserId = uiState.currentUserId,
                onDismiss = { showBackpackSheet = false }
            )
        }

        // Spin-the-Wheel overlay
        if (showGachaWheel && uiState.hasJoined) {
            LuckySpinOverlay(
                gachaState = gachaState,
                onSpin = gachaViewModel::pullSingle,
                onQuickSpin = { count ->
                    when (count) {
                        10 -> gachaViewModel.pullTen()
                        100 -> gachaViewModel.pullHundred()
                    }
                },
                onAdvanceMultiSpin = gachaViewModel::advanceMultiSpin,
                onSkipMultiSpin = gachaViewModel::skipMultiSpin,
                onDismissResults = gachaViewModel::dismissResults,
                onDismiss = { showGachaWheel = false },
                onTestPurchase = { coins -> gachaViewModel.testPurchase(coins) }
            )
        }

        // Daily Reward Dialog
        if (showDailyReward) {
            currentUser?.let { user ->
                LaunchedEffect(Unit) {
                    dailyRewardViewModel.checkAndShowDialog(user)
                }
                DailyRewardDialog(
                    viewModel = dailyRewardViewModel,
                    onDismiss = { showDailyReward = false }
                )
            }
        }

        // Broadcast Banner (top overlay)
        BroadcastBanner(
            broadcast = latestBroadcast,
            modifier = Modifier.align(Alignment.TopCenter)
        )

        // Full-screen gift effect overlay
        if (showGiftEffect) {
            GiftEffectOverlay(
                animationUrl = giftEffectAnimUrl,
                soundUrl = giftEffectSoundUrl,
                isVisible = true,
                onFinished = { showGiftEffect = false },
                modifier = Modifier.fillMaxSize()
            )
        }
        }
    }
}
