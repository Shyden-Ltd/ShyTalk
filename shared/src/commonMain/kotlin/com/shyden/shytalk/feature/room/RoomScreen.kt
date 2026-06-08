package com.shyden.shytalk.feature.room

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
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.MicOff
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.shyden.shytalk.core.effects.PlatformBackHandler
import com.shyden.shytalk.core.model.Broadcast
import com.shyden.shytalk.core.model.BroadcastType
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.GiftEvent
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.RoomState
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.core.platform.PlatformImagePicker
import com.shyden.shytalk.core.platform.PlatformMultiImagePicker
import com.shyden.shytalk.core.platform.PlatformSettingsService
import com.shyden.shytalk.core.ui.BroadcastBanner
import com.shyden.shytalk.core.ui.DegradedModeBanner
import com.shyden.shytalk.core.ui.GiftEffectOverlay
import com.shyden.shytalk.core.ui.GiftPreviewPopup
import com.shyden.shytalk.core.ui.StyledSnackbarHost
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.feature.daily.DailyRewardCelebrationDialog
import com.shyden.shytalk.feature.daily.DailyRewardDialog
import com.shyden.shytalk.feature.daily.DailyRewardViewModel
import com.shyden.shytalk.feature.gacha.GachaViewModel
import com.shyden.shytalk.feature.gacha.LuckySpinOverlay
import com.shyden.shytalk.feature.gifting.GiftingViewModel
import com.shyden.shytalk.feature.messaging.ConversationListViewModel
import com.shyden.shytalk.feature.messaging.PmBottomSheet
import com.shyden.shytalk.feature.room.components.BackpackSheet
import com.shyden.shytalk.feature.room.components.ChatPanel
import com.shyden.shytalk.feature.room.components.OwnerAwayBanner
import com.shyden.shytalk.feature.room.components.ParticipantInfo
import com.shyden.shytalk.feature.room.components.ParticipantListPanel
import com.shyden.shytalk.feature.room.components.RoomActionCarousel
import com.shyden.shytalk.feature.room.components.RoomClosedSummaryPanel
import com.shyden.shytalk.feature.room.components.RoomNotificationOverlay
import com.shyden.shytalk.feature.room.components.RoomStarfieldBackground
import com.shyden.shytalk.feature.room.components.RoomToolbar
import com.shyden.shytalk.feature.room.components.SeatActionFeedback
import com.shyden.shytalk.feature.room.components.SeatGrid
import com.shyden.shytalk.feature.room.components.UserCardPopup
import com.shyden.shytalk.feature.settings.RoomSettingsSheet
import com.shyden.shytalk.feature.shop.WalletViewModel
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.ui.components.seasonal.SeasonalBackground
import com.shyden.shytalk.ui.theme.DarkColorScheme
import com.shyden.shytalk.ui.theme.SeasonalTheme
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.drop
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomScreen(
    roomId: String,
    isBackendDegraded: Boolean = false,
    onNavigateBack: () -> Unit,
    onNavigateToUserProfile: (String) -> Unit = {},
    onNavigateToChat: (String) -> Unit = {},
    onNavigateToWallet: () -> Unit = {},
    onNavigateToAgeVerification: () -> Unit = {},
    viewModel: RoomViewModel = koinViewModel { parametersOf(roomId) },
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val conversationListViewModel: ConversationListViewModel = koinInject()
    val convListState by conversationListViewModel.uiState.collectAsStateWithLifecycle()
    val gachaViewModel: GachaViewModel = koinInject()
    val giftingViewModel: GiftingViewModel = koinInject()
    val dailyRewardViewModel: DailyRewardViewModel = koinInject()
    val gachaState by gachaViewModel.uiState.collectAsStateWithLifecycle()
    val giftingState by giftingViewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var wasEverDegraded by remember { mutableStateOf(isBackendDegraded) }
    LaunchedEffect(isBackendDegraded) {
        if (wasEverDegraded && !isBackendDegraded) {
            snackbarHostState.showSnackbar(
                "Service restored — close this room and open a new one for full functionality",
            )
        }
        if (isBackendDegraded) wasEverDegraded = true
    }
    var showSettings by remember(roomId) { mutableStateOf(false) }
    var showUserCardForId by remember(roomId) { mutableStateOf<String?>(null) }
    var showParticipantPanel by remember(roomId) { mutableStateOf(false) }
    var showRoomNameDialog by remember(roomId) { mutableStateOf(false) }
    var showPmSheet by remember(roomId) { mutableStateOf(false) }
    var pmSheetPreOpenUserId by remember(roomId) { mutableStateOf<String?>(null) }
    var pmSheetPreOpenGroupConversationId by remember(roomId) { mutableStateOf<String?>(null) }
    val activeRoomManager: com.shyden.shytalk.core.room.ActiveRoomManager = koinInject()
    var showGachaWheel by remember(roomId) { mutableStateOf(false) }
    var showDailyReward by remember(roomId) { mutableStateOf(false) }
    var showBackpackSheet by remember(roomId) { mutableStateOf(false) }
    var additionalBackpackRecipient by remember(roomId) { mutableStateOf<com.shyden.shytalk.core.model.User?>(null) }
    var previewGift by remember { mutableStateOf<Gift?>(null) }
    var showSuperShySheet by remember(roomId) { mutableStateOf(false) }
    var showWalletSheet by remember(roomId) { mutableStateOf(false) }
    val currentGiftEvent by viewModel.giftAnimationQueue.currentEvent.collectAsStateWithLifecycle()
    val giftRepository: GiftRepository = koinInject()
    val roomBroadcasts = remember { mutableStateListOf<Broadcast>() }

    // Convert room gift events into Broadcast objects for the sliding banner
    LaunchedEffect(currentGiftEvent) {
        currentGiftEvent?.let { event ->
            roomBroadcasts.add(
                Broadcast(
                    id = "room_${event.eventId}",
                    type = BroadcastType.GIFT_SEND,
                    senderName = event.senderName,
                    recipientName = event.recipientName,
                    giftName = event.giftName,
                    giftCoinValue = event.coinValue,
                    quantity = event.quantity,
                    timestamp = currentTimeMillis(),
                ),
            )
        }
    }

    // Open PmBottomSheet when a notification is tapped while in a room
    val pendingPm by activeRoomManager.pendingPmOpen.collectAsStateWithLifecycle()
    LaunchedEffect(pendingPm) {
        pendingPm?.let { pm ->
            pmSheetPreOpenUserId = pm.userId
            pmSheetPreOpenGroupConversationId = pm.groupConversationId
            showPmSheet = true
            activeRoomManager.consumePendingPmOpen()
        }
    }

    // Observe app-wide Firestore broadcasts (high-value gifts & gacha wins from all rooms)
    LaunchedEffect(Unit) {
        giftRepository
            .observeBroadcasts()
            .drop(1) // Skip the initial snapshot to avoid replaying old broadcasts
            .catch { /* ignore errors */ }
            .collect { broadcasts ->
                for (b in broadcasts) {
                    if (b.id.isNotEmpty() && roomBroadcasts.none { it.id == b.id }) {
                        roomBroadcasts.add(b)
                    }
                }
            }
    }

    var pmImageResultHandler by remember { mutableStateOf<((List<ByteArray>) -> Unit)?>(null) }
    var pmStickerResultHandler by remember { mutableStateOf<((ByteArray) -> Unit)?>(null) }
    val reportEvidenceList = remember { mutableListOf<Pair<ByteArray, String>>() }
    var reportEvidenceVersion by remember { mutableStateOf(0) }
    // B3 — room message reporting: holds the message the user long-pressed,
    // null while no dialog open. Distinct state from reportEvidenceList (user
    // reports) because room MESSAGE reports do not collect evidence — the
    // message text + messageId IS the evidence.
    var reportingRoomMessage by remember { mutableStateOf<Message?>(null) }
    var isCompressingEvidence by remember { mutableStateOf(false) }

    val evidenceScope = rememberCoroutineScope()
    val fileTooLargeMsg = stringResource(Res.string.file_too_large)
    val platformSettings: PlatformSettingsService = org.koin.compose.koinInject()

    var launchEvidencePicker by remember { mutableStateOf<(() -> Unit)?>(null) }
    var launchPmImagePicker by remember { mutableStateOf<(() -> Unit)?>(null) }
    var launchStickerPicker by remember { mutableStateOf<(() -> Unit)?>(null) }

    PlatformImagePicker(
        onImageSelected = { bytes ->
            if (bytes != null) {
                if (bytes.size <= Constants.EVIDENCE_MAX_SIZE_BYTES) {
                    reportEvidenceList.add(bytes to "image/jpeg")
                    reportEvidenceVersion++
                } else {
                    evidenceScope.launch { snackbarHostState.showSnackbar(fileTooLargeMsg) }
                }
            }
        },
    ) { launcher -> launchEvidencePicker = launcher }

    PlatformMultiImagePicker(
        maxCount = 10,
        onImagesSelected = { bytesList ->
            if (bytesList.isNotEmpty()) {
                pmImageResultHandler?.invoke(bytesList)
            }
        },
    ) { launcher -> launchPmImagePicker = launcher }

    PlatformImagePicker(
        onImageSelected = { bytes ->
            if (bytes != null) {
                pmStickerResultHandler?.invoke(bytes)
            }
        },
    ) { launcher -> launchStickerPicker = launcher }

    val currentUser = uiState.allKnownUsers[uiState.currentUserId]

    // Clear gift sending state (chat message from Cloud Function is sufficient feedback)
    LaunchedEffect(giftingState.sentGiftId) {
        if (giftingState.sentGiftName != null) {
            giftingViewModel.clearSentGift()
        }
    }

    // Handle gacha win — trigger GiftEffectOverlay for RARE+ single wins
    LaunchedEffect(gachaState.currentWin) {
        val win = gachaState.currentWin ?: return@LaunchedEffect
        if (win.coinValue >= 500) {
            // Delay so the wheel celebration finishes first
            kotlinx.coroutines.delay(2600)
            viewModel.giftAnimationQueue.enqueue(
                GiftEvent(
                    giftId = win.giftId,
                    giftName = win.giftName,
                    senderName = uiState.currentUserName,
                    recipientName = uiState.currentUserName,
                ),
            )
        }
    }

    // Handle gacha errors
    LaunchedEffect(gachaState.error) {
        gachaState.error?.let {
            snackbarHostState.showSnackbar(it.resolveAsync())
            gachaViewModel.clearError()
        }
    }

    // Handle gifting errors
    LaunchedEffect(giftingState.error) {
        giftingState.error?.let {
            snackbarHostState.showSnackbar(it.resolveAsync())
            giftingViewModel.clearError()
        }
    }

    // Track room screen visibility for chathead
    DisposableEffect(Unit) {
        viewModel.setRoomScreenVisible(true)
        onDispose { viewModel.setRoomScreenVisible(false) }
    }

    // Keep screen on while in room (expect/actual per platform)
    com.shyden.shytalk.core.effects
        .KeepScreenOn()

    // Self-destruct announcement TTS (expect/actual per platform)
    var selfDestructAnnounced by remember(roomId) { mutableStateOf(false) }
    DisposableEffect(Unit) {
        onDispose {
            com.shyden.shytalk.core.audio.PlatformTts
                .release()
        }
    }

    val selfDestructEnabled = currentUser?.selfDestructAlertEnabled == true
    LaunchedEffect(uiState.roomExpiryRemainingMs, uiState.ownerAwayRemainingMs, selfDestructEnabled) {
        val expiryActive = uiState.roomExpiryRemainingMs in 1..300_000L
        val ownerAwayActive = uiState.ownerAwayRemainingMs in 1..300_000L
        if (selfDestructEnabled && !selfDestructAnnounced && (expiryActive || ownerAwayActive)) {
            selfDestructAnnounced = true
            com.shyden.shytalk.core.audio.PlatformTts.speak(
                "Room self destruct sequence activated. Self destruct in T minus 5 minutes.",
                "self_destruct",
            )
        } else if (selfDestructAnnounced && !expiryActive && !ownerAwayActive) {
            selfDestructAnnounced = false
            if (selfDestructEnabled) {
                com.shyden.shytalk.core.audio.PlatformTts.speak(
                    "Self destruct sequence deactivated.",
                    "self_destruct_off",
                )
            }
        }
    }

    // Audio permission handling (cross-platform via expect/actual)
    val scope = rememberCoroutineScope()
    val micDeniedMsg = stringResource(Res.string.mic_permission_denied)
    com.shyden.shytalk.core.effects.RequestMicPermission { granted ->
        viewModel.onAudioPermissionResult(granted)
        if (!granted) {
            scope.launch { snackbarHostState.showSnackbar(micDeniedMsg) }
        }
    }

    // System back navigates back without leaving the room (voice persists)
    PlatformBackHandler(enabled = !showParticipantPanel && uiState.hasJoined) {
        onNavigateBack()
    }

    PlatformBackHandler(enabled = showParticipantPanel) {
        showParticipantPanel = false
    }

    // Show kicked dialog
    if (uiState.wasKicked) {
        AlertDialog(
            onDismissRequest = {},
            title = { Text(stringResource(Res.string.removed_from_room)) },
            text = {
                Column {
                    val kickedBy = uiState.kickedByName
                    if (kickedBy != null) {
                        Text(stringResource(Res.string.kicked_by_name, kickedBy))
                    } else {
                        Text(stringResource(Res.string.kicked_from_room))
                    }
                    val reason = uiState.kickReason
                    if (reason != null) {
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = stringResource(Res.string.kick_reason, reason),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(onClick = { onNavigateBack() }) {
                    Text(stringResource(Res.string.ok))
                }
            },
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

    val reportThankYouMsg = stringResource(Res.string.report_thank_you)
    LaunchedEffect(uiState.reportSubmitted) {
        if (uiState.reportSubmitted) {
            showUserCardForId = null
            reportEvidenceList.clear()
            reportEvidenceVersion++
            snackbarHostState.showSnackbar(reportThankYouMsg)
            viewModel.clearReportSubmitted()
        }
    }

    if (uiState.seatActionStatus is SeatActionStatus.Loading) {
        SeatActionFeedback(message = (uiState.seatActionStatus as SeatActionStatus.Loading).message)
    }

    // Block warning dialogs
    uiState.blockWarning?.let { warning ->
        val (title, message, showEnterOption) =
            when (warning) {
                is BlockWarning.Banned -> {
                    val reason =
                        buildString {
                            append(stringResource(Res.string.you_were_banned))
                            warning.kickerName?.let { name ->
                                append("\n${stringResource(Res.string.banned_by, name)}")
                            }
                            warning.reason?.takeIf { it.isNotBlank() }?.let { r ->
                                append("\n${stringResource(Res.string.kick_reason, r)}")
                            }
                        }
                    Triple(stringResource(Res.string.banned_from_room), reason, false)
                }

                is BlockWarning.BlockedByRoomOwner ->
                    Triple(
                        stringResource(Res.string.cannot_enter_room),
                        stringResource(Res.string.not_allowed_to_enter),
                        false,
                    )

                is BlockWarning.BlockedUserInRoom ->
                    Triple(
                        stringResource(Res.string.blocked_user_in_room),
                        stringResource(Res.string.blocked_user_in_room_description),
                        true,
                    )

                is BlockWarning.BlockedByUserInRoom ->
                    Triple(
                        stringResource(Res.string.notice),
                        stringResource(Res.string.blocked_by_user_in_room_description),
                        true,
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
                    Text(if (showEnterOption) stringResource(Res.string.enter) else stringResource(Res.string.go_back))
                }
            },
            dismissButton =
                if (showEnterOption) {
                    {
                        TextButton(onClick = { onNavigateBack() }) {
                            Text(stringResource(Res.string.choose_another_room))
                        }
                    }
                } else {
                    null
                },
        )
    }

    // Compute participant lists for the panel (memoized to avoid recomposition waste)
    val room = uiState.room
    val participantUsers = uiState.participantUsers

    val seatedUserIds =
        remember(room) {
            room
                ?.seats
                ?.values
                ?.filter { it.state == SeatState.OCCUPIED && it.userId != null }
                ?.mapNotNull { it.userId }
                ?.toSet() ?: emptySet()
        }

    val voiceUsers by remember(room, participantUsers, seatedUserIds) {
        derivedStateOf {
            val currentRoom = room ?: return@derivedStateOf emptyList<ParticipantInfo>()
            seatedUserIds
                .mapNotNull { uid ->
                    participantUsers[uid]?.let { user ->
                        val seat = currentRoom.findUserSeat(uid)?.value
                        ParticipantInfo(user, currentRoom.resolveRole(uid), isMuted = seat?.isMuted ?: false)
                    }
                }.sortedWith(
                    compareBy<ParticipantInfo> { it.role.ordinal }
                        .thenBy { it.user.displayName.lowercase() },
                )
        }
    }

    val audienceUsers by remember(room, participantUsers, seatedUserIds) {
        derivedStateOf {
            val currentRoom = room ?: return@derivedStateOf emptyList<ParticipantInfo>()
            currentRoom.participantIds
                .filter { it !in seatedUserIds }
                .mapNotNull { uid ->
                    participantUsers[uid]?.let { user ->
                        ParticipantInfo(user, currentRoom.resolveRole(uid))
                    }
                }.sortedWith(
                    compareBy<ParticipantInfo> { it.role.ordinal }
                        .thenBy { it.user.displayName.lowercase() },
                )
        }
    }

    val isOwnerOrHost by remember {
        derivedStateOf {
            uiState.currentRole == RoomRole.OWNER || uiState.currentRole == RoomRole.HOST
        }
    }

    // Merged user map for ChatPanel — use allKnownUsers so departed users keep their avatars
    val userMap =
        remember(uiState.allKnownUsers) {
            uiState.allKnownUsers
        }

    val seasonalEvent = SeasonalTheme.activeEvent()
    val roomColorScheme =
        seasonalEvent?.let { event ->
            DarkColorScheme.copy(
                primary = event.primaryColor,
                primaryContainer = event.primaryColor.copy(alpha = 0.3f),
                onPrimaryContainer = event.primaryColor,
                tertiary = event.accentColor,
                tertiaryContainer = event.accentColor.copy(alpha = 0.3f),
            )
        } ?: DarkColorScheme

    MaterialTheme(colorScheme = roomColorScheme) {
        Box(
            modifier = Modifier.fillMaxSize(),
        ) {
            if (seasonalEvent != null) {
                SeasonalBackground()
            } else {
                RoomStarfieldBackground(modifier = Modifier.fillMaxSize())
            }
            Scaffold(
                containerColor = Color.Transparent,
                snackbarHost = { StyledSnackbarHost(snackbarHostState) },
                topBar = {
                    if (!uiState.roomClosed) {
                        RoomToolbar(
                            roomName = uiState.room?.name ?: stringResource(Res.string.room),
                            participantCount = uiState.room?.participantIds?.size ?: 0,
                            roomExpiryRemainingMs = uiState.roomExpiryRemainingMs,
                            onBack = { onNavigateBack() },
                            onTogglePeople = { showParticipantPanel = !showParticipantPanel },
                            onRoomNameClick = { showRoomNameDialog = true },
                            onSettings = { showSettings = true },
                        )
                    }
                },
            ) { padding ->
                Box(
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .padding(padding)
                            .consumeWindowInsets(padding),
                ) {
                    val closedSummary = uiState.roomClosedSummary
                    if (uiState.roomClosed && closedSummary != null) {
                        RoomClosedSummaryPanel(
                            summary = closedSummary,
                            onDismiss = onNavigateBack,
                        )
                    } else if (uiState.roomClosed) {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center,
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                CircularProgressIndicator()
                                Spacer(modifier = Modifier.height(16.dp))
                                Text(
                                    text = stringResource(Res.string.closing),
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    } else if (uiState.isLoading) {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator()
                        }
                    } else if (!uiState.hasJoined && uiState.blockWarning == null) {
                        // Loading state while block check is in progress
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center,
                        ) {
                            CircularProgressIndicator()
                        }
                    } else if (uiState.hasJoined && !uiState.isVoiceReady) {
                        // Loading screen while connecting to voice
                        Column(
                            modifier = Modifier.fillMaxSize(),
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.Center,
                        ) {
                            Text(
                                text = uiState.room?.name ?: stringResource(Res.string.room),
                                style = MaterialTheme.typography.headlineSmall,
                                color = MaterialTheme.colorScheme.onBackground,
                            )
                            Spacer(modifier = Modifier.height(24.dp))
                            CircularProgressIndicator()
                            Spacer(modifier = Modifier.height(16.dp))
                            Text(
                                text = stringResource(Res.string.connecting),
                                style = MaterialTheme.typography.bodyMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                            )
                        }
                    } else if (uiState.hasJoined) {
                        Column(modifier = Modifier.fillMaxSize().imePadding()) {
                            // Degraded Mode Banner
                            if (isBackendDegraded) {
                                DegradedModeBanner()
                            }

                            // Owner Away Banner
                            if (uiState.room?.state == RoomState.OWNER_AWAY) {
                                OwnerAwayBanner(
                                    remainingMs = uiState.ownerAwayRemainingMs,
                                )
                            }

                            // Voice Unavailable Banner
                            if (uiState.isVoiceUnavailable) {
                                Row(
                                    modifier =
                                        Modifier
                                            .fillMaxWidth()
                                            .background(Color(0xFFFFF3E0))
                                            .padding(horizontal = 16.dp, vertical = 8.dp),
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.Center,
                                ) {
                                    Icon(
                                        Icons.Default.MicOff,
                                        contentDescription =
                                            stringResource(Res.string.microphone) + " " + stringResource(Res.string.denied).lowercase(),
                                        tint = Color(0xFFE65100),
                                        modifier = Modifier.padding(end = 8.dp),
                                    )
                                    Text(
                                        text =
                                            uiState.voiceErrorDetail
                                                ?: stringResource(Res.string.voice_chat_unavailable),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = Color(0xFFE65100),
                                    )
                                }
                            }

                            // Seat Grid (upper portion — only occupied seats)
                            val isCurrentUserSeated = uiState.currentUserId in seatedUserIds
                            val showRequestSeat =
                                !isCurrentUserSeated &&
                                    uiState.room?.requireApproval != true

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
                                effectiveSeatCount = uiState.effectiveSeatCount,
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
                                aliases = uiState.aliases,
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .weight(1f)
                                        .padding(horizontal = 12.dp, vertical = 8.dp)
                                        .testTag("room_seatGrid"),
                            )

                            // Chat Panel (lower portion)
                            ChatPanel(
                                messages = uiState.messages,
                                currentUserId = uiState.currentUserId,
                                currentRole = uiState.currentRole,
                                seats = uiState.room?.seats ?: emptyMap(),
                                userMap = userMap,
                                _isOwnerOrHost = isOwnerOrHost,
                                isVoiceUnavailable = uiState.isVoiceUnavailable,
                                onToggleMic = { seatIndex ->
                                    if (platformSettings.hasPermission("microphone")) {
                                        viewModel.toggleSelfMute(seatIndex)
                                    }
                                },
                                onSendMessage = { viewModel.sendMessage(it) },
                                onTapUser = { userId ->
                                    showUserCardForId = userId
                                },
                                onInviteUser = { senderId, senderName ->
                                    viewModel.inviteFromMessage(senderId, senderName)
                                },
                                onToggleMessages = {
                                    pmSheetPreOpenUserId = null
                                    pmSheetPreOpenGroupConversationId = null
                                    showPmSheet = true
                                },
                                unreadCount = convListState.totalUnreadCount.toInt(),
                                onOpenBackpack = {
                                    showBackpackSheet = true
                                },
                                editingMessageId = uiState.editingMessageId,
                                editingMessageText = uiState.editingMessageText,
                                onStartEditMessage = { messageId, text -> viewModel.startEditMessage(messageId, text) },
                                onEditMessage = { viewModel.editMessage(it) },
                                onCancelEdit = { viewModel.cancelEditMessage() },
                                aliases = uiState.aliases,
                                translations = uiState.translations,
                                onTranslateMessage = { viewModel.translateMessage(it) },
                                onReportMessage = { msg -> reportingRoomMessage = msg },
                                modifier =
                                    Modifier
                                        .fillMaxWidth()
                                        .weight(1f),
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
                        modifier = Modifier.align(Alignment.Center),
                    )

                    // Scrim overlay
                    if (showParticipantPanel) {
                        Box(
                            modifier =
                                Modifier
                                    .fillMaxSize()
                                    .background(Color.Black.copy(alpha = 0.4f))
                                    .clickable(
                                        indication = null,
                                        interactionSource = remember { MutableInteractionSource() },
                                    ) { showParticipantPanel = false },
                        )
                    }

                    // Sliding participant panel from right
                    AnimatedVisibility(
                        visible = showParticipantPanel,
                        enter =
                            slideInHorizontally(
                                initialOffsetX = { fullWidth -> fullWidth },
                                animationSpec = tween(300),
                            ),
                        exit =
                            slideOutHorizontally(
                                targetOffsetX = { fullWidth -> fullWidth },
                                animationSpec = tween(300),
                            ),
                        modifier = Modifier.align(Alignment.CenterEnd),
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
                            aliases = uiState.aliases,
                            modifier =
                                Modifier
                                    .fillMaxHeight()
                                    .fillMaxWidth(0.7f),
                        )
                    }

                    // Floating action carousel (bottom-right, inside scaffold content to respect padding)
                    if (uiState.hasJoined && !uiState.roomClosed) {
                        RoomActionCarousel(
                            onOpenGacha = { showGachaWheel = true },
                            onOpenDailyReward = { showDailyReward = true },
                            modifier =
                                Modifier
                                    .align(Alignment.BottomEnd)
                                    .padding(bottom = 64.dp, end = 8.dp),
                        )
                    }

                    // Sliding gold broadcast banner for room gift events (just above the seat grid)
                    BroadcastBanner(
                        broadcasts = roomBroadcasts.toList(),
                        modifier = Modifier.align(Alignment.TopCenter),
                    )
                }

                if (showSettings && uiState.room != null) {
                    RoomSettingsSheet(
                        roomId = roomId,
                        onDismiss = { showSettings = false },
                        onCloseRoom = {
                            showSettings = false
                            viewModel.closeRoom()
                        },
                    )
                }

                if (showRoomNameDialog && uiState.room != null) {
                    val isOwner = uiState.currentRole == RoomRole.OWNER
                    if (isOwner) {
                        var editedName by remember(showRoomNameDialog, isOwner) { mutableStateOf(uiState.room?.name ?: "") }
                        AlertDialog(
                            onDismissRequest = { showRoomNameDialog = false },
                            title = { Text(stringResource(Res.string.edit_room_name)) },
                            text = {
                                OutlinedTextField(
                                    value = editedName,
                                    onValueChange = { if (it.length <= 50) editedName = it },
                                    singleLine = true,
                                    placeholder = { Text(stringResource(Res.string.room_name)) },
                                )
                            },
                            confirmButton = {
                                TextButton(
                                    onClick = {
                                        viewModel.updateRoomName(editedName.trim())
                                        showRoomNameDialog = false
                                    },
                                    enabled = editedName.isNotBlank(),
                                ) {
                                    Text(stringResource(Res.string.save))
                                }
                            },
                            dismissButton = {
                                TextButton(onClick = { showRoomNameDialog = false }) {
                                    Text(stringResource(Res.string.cancel))
                                }
                            },
                        )
                    } else {
                        AlertDialog(
                            onDismissRequest = { showRoomNameDialog = false },
                            title = { Text(stringResource(Res.string.room_name)) },
                            text = {
                                Text(
                                    text = uiState.room?.name ?: "",
                                    style = MaterialTheme.typography.bodyLarge,
                                )
                            },
                            confirmButton = {
                                TextButton(onClick = { showRoomNameDialog = false }) {
                                    Text(stringResource(Res.string.close))
                                }
                            },
                        )
                    }
                }

                // User card popup when tapping a user
                showUserCardForId?.let { userId ->
                    val movableSeats =
                        remember(uiState.room?.seats, userId) {
                            uiState.room
                                ?.seats
                                ?.entries
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
                        val canInviteFromCard =
                            (uiState.currentRole == RoomRole.OWNER || uiState.currentRole == RoomRole.HOST) &&
                                userId != uiState.currentUserId &&
                                isInRoom &&
                                !isTargetSeated &&
                                userId !in (uiState.room?.pendingInvites?.keys ?: emptySet())

                        // Mod capabilities: owner can act on hosts + attendees; hosts can act on attendees only
                        val isNotSelf = userId != uiState.currentUserId
                        val isOwner = uiState.currentRole == RoomRole.OWNER
                        val isHostOrOwner = isOwner || uiState.currentRole == RoomRole.HOST
                        val canModerate =
                            isNotSelf &&
                                isTargetSeated &&
                                isHostOrOwner &&
                                (isOwner || targetRole == RoomRole.ATTENDEE) &&
                                userId != uiState.room?.ownerId
                        // Kick is allowed even for unseated users
                        val canKick =
                            isNotSelf &&
                                isHostOrOwner &&
                                (isOwner || targetRole == RoomRole.ATTENDEE) &&
                                userId != uiState.room?.ownerId

                        UserCardPopup(
                            user = user,
                            isBlocked = userId in uiState.blockedUserIds,
                            isSelf = userId == uiState.currentUserId,
                            onViewProfile = {
                                showUserCardForId = null
                                onNavigateToUserProfile(userId)
                            },
                            onMessage =
                                if (userId != uiState.currentUserId) {
                                    {
                                        showUserCardForId = null
                                        pmSheetPreOpenUserId = userId
                                        showPmSheet = true
                                    }
                                } else {
                                    null
                                },
                            onSendGift =
                                if (userId != uiState.currentUserId) {
                                    {
                                        showUserCardForId = null
                                        giftingViewModel.deselectAllRecipients()
                                        giftingViewModel.toggleRecipient(userId)
                                        // If user is not seated, pass them as an additional recipient
                                        val isSeated = userId in seatedUserIds
                                        additionalBackpackRecipient = if (!isSeated) user else null
                                        showBackpackSheet = true
                                    }
                                } else {
                                    null
                                },
                            onBlock = {
                                viewModel.blockUser(userId)
                                showUserCardForId = null
                            },
                            onUnblock = {
                                viewModel.unblockUser(userId)
                                showUserCardForId = null
                            },
                            onInvite =
                                if (canInviteFromCard) {
                                    {
                                        viewModel.inviteFromMessage(userId, user.displayName)
                                        showUserCardForId = null
                                    }
                                } else {
                                    null
                                },
                            onMuteToggle =
                                if (canModerate &&
                                    targetSeatIndex != null &&
                                    targetSeatEntry.value.isMuted != true
                                ) {
                                    { viewModel.forceMuteUser(targetSeatIndex) }
                                } else {
                                    null
                                },
                            isTargetMuted = targetSeatEntry?.value?.isMuted ?: false,
                            onRemoveFromSeat =
                                if (canModerate &&
                                    targetSeatIndex != null &&
                                    targetSeatIndex != Constants.OWNER_SEAT_INDEX
                                ) {
                                    { viewModel.removeFromSeat(targetSeatIndex) }
                                } else {
                                    null
                                },
                            onKickFromRoom =
                                if (canKick) {
                                    { reason -> viewModel.kickUser(userId, targetSeatIndex, reason) }
                                } else {
                                    null
                                },
                            onMoveSeat =
                                if (canModerate &&
                                    targetSeatIndex != null &&
                                    movableSeats.isNotEmpty() &&
                                    targetSeatIndex != Constants.OWNER_SEAT_INDEX
                                ) {
                                    { toIndex -> viewModel.moveSeat(targetSeatIndex, toIndex) }
                                } else {
                                    null
                                },
                            emptySeats = movableSeats,
                            seatOccupantNames =
                                run {
                                    val fallbackName = stringResource(Res.string.user)
                                    remember(uiState.room?.seats, uiState.seatUsers, fallbackName) {
                                        uiState.room
                                            ?.seats
                                            ?.entries
                                            ?.filter { it.value.state == SeatState.OCCUPIED && it.value.userId != null }
                                            ?.associate { (key, seat) ->
                                                key.toInt() to (uiState.seatUsers[seat.userId]?.displayName ?: fallbackName)
                                            } ?: emptyMap()
                                    }
                                },
                            onMakeHost =
                                if (isOwner &&
                                    isNotSelf &&
                                    isTargetSeated &&
                                    targetRole == RoomRole.ATTENDEE
                                ) {
                                    { viewModel.addHost(userId) }
                                } else {
                                    null
                                },
                            onRemoveHost =
                                if (isOwner && isNotSelf && targetRole == RoomRole.HOST) {
                                    { viewModel.removeHost(userId) }
                                } else {
                                    null
                                },
                            isHost = targetRole == RoomRole.HOST,
                            onReportUser =
                                if (userId != uiState.currentUserId) {
                                    { reason, description ->
                                        viewModel.reportUser(userId, reason, description, reportEvidenceList.toList())
                                    }
                                } else {
                                    null
                                },
                            evidenceItems = reportEvidenceList.map { it.first }.also { _ -> reportEvidenceVersion },
                            onAddEvidence = {
                                launchEvidencePicker?.invoke()
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
                            currentAlias = uiState.aliases[userId],
                            onSetAlias = { alias -> viewModel.setAlias(userId, alias) },
                            onRemoveAlias = { viewModel.removeAlias(userId) },
                            onDismiss = {
                                showUserCardForId = null
                                reportEvidenceList.clear()
                                reportEvidenceVersion++
                            },
                        )
                    }
                }

                // PM Bottom Sheet
                if (showPmSheet) {
                    PmBottomSheet(
                        onDismiss = {
                            showPmSheet = false
                            pmSheetPreOpenUserId = null
                            pmSheetPreOpenGroupConversationId = null
                        },
                        preOpenUserId = pmSheetPreOpenUserId,
                        preOpenGroupConversationId = pmSheetPreOpenGroupConversationId,
                        onPickImages = { vm ->
                            pmImageResultHandler = { bytesList -> vm.uploadAndSendImages(bytesList) }
                            launchPmImagePicker?.invoke()
                        },
                        onPickStickerImage = { vm ->
                            pmStickerResultHandler = { bytes -> vm.addStickerFromImage(bytes) }
                            launchStickerPicker?.invoke()
                        },
                        activeRoomId = roomId,
                        activeRoomName = uiState.room?.name,
                    )
                }

                // Backpack Sheet for sending/viewing gifts
                if (showBackpackSheet) {
                    BackpackSheet(
                        viewModel = giftingViewModel,
                        seatedUsers = uiState.seatUsers.values.toList(),
                        additionalUsers = listOfNotNull(additionalBackpackRecipient),
                        currentUserId = uiState.currentUserId,
                        onDismiss = {
                            showBackpackSheet = false
                            additionalBackpackRecipient = null
                        },
                        onNavigateToWallet = { showWalletSheet = true },
                        onLongPressGift = { gift -> previewGift = gift },
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
                        onTestPurchase = { coins -> gachaViewModel.testPurchase(coins) },
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
                            onDismiss = { showDailyReward = false },
                        )
                    }
                }

                // Daily Reward Celebration (shown after claiming)
                val dailyRewardState by dailyRewardViewModel.uiState.collectAsStateWithLifecycle()
                if (dailyRewardState.showCelebration) {
                    DailyRewardCelebrationDialog(
                        viewModel = dailyRewardViewModel,
                        onDismiss = { showDailyReward = false },
                    )
                }

                // Gift preview popup (long-press)
                previewGift?.let { gift ->
                    GiftPreviewPopup(
                        gift = gift,
                        onDismiss = { previewGift = null },
                    )
                }

                // Expiry upsell dialog
                if (uiState.showExpiryUpsellDialog) {
                    com.shyden.shytalk.feature.room.components.ExpiryUpsellDialog(
                        isViewerSuperShy = currentUser?.isSuperShy == true,
                        superShyDurationHours = viewModel.superShyDurationHours,
                        onDismiss = { viewModel.dismissExpiryUpsellDialog() },
                        onOpenSuperShy = { showSuperShySheet = true },
                    )
                }

                // Super Shy bottom sheet (opened from expiry upsell)
                if (showSuperShySheet && currentUser != null) {
                    com.shyden.shytalk.feature.shop.SuperShyBottomSheet(
                        user = currentUser,
                        onDismiss = { showSuperShySheet = false },
                    )
                }

                // Coin purchase sheet (shown when user has insufficient coins)
                if (showWalletSheet) {
                    val walletViewModel: WalletViewModel =
                        org.koin.compose.viewmodel
                            .koinViewModel()
                    val walletState by walletViewModel.uiState.collectAsStateWithLifecycle()

                    ModalBottomSheet(
                        onDismissRequest = { showWalletSheet = false },
                    ) {
                        com.shyden.shytalk.feature.shop.CoinPurchaseSheetContent(
                            coinBalance = walletState.coinBalance,
                            coinPackages = walletState.coinPackages,
                            isPurchasing = walletState.isPurchasing,
                            onPurchasePackage = { _ ->
                                // Billing is handled by the platform-specific flow (Google Play / StoreKit).
                                // In prod, the room sheet does not launch billing directly —
                                // users are directed to the full Wallet screen for purchases.
                            },
                            _onDismiss = { showWalletSheet = false },
                        )
                    }
                }

                // Full-screen gift effect overlay (room-wide via AnimationQueue)
                currentGiftEvent?.let { event ->
                    GiftEffectOverlay(
                        event = event,
                        onFinished = { viewModel.giftAnimationQueue.onAnimationFinished() },
                        modifier = Modifier.fillMaxSize(),
                    )
                }
            }
        }
    }

    // Age-verification gate dialog for Gacha (PR 9 follow-up). The
    // dialog's interactive elements carry testTags inside
    // AgeRestrictionDialog.kt (TAG_NEEDS_VERIFICATION_CONFIRM etc.).
    // NeedsVerification routes to the submit screen; SubEighteen offers
    // contact-support (no entry into the verification flow).
    val gachaAgeRestrictionState by gachaViewModel.ageRestrictionDialogState.collectAsStateWithLifecycle()
    com.shyden.shytalk.feature.ageverification.AgeRestrictionDialog(
        state = gachaAgeRestrictionState,
        onDismiss = { gachaViewModel.dismissAgeRestrictionDialog() },
        onVerifyNow = onNavigateToAgeVerification,
        onContactSupport = { gachaViewModel.dismissAgeRestrictionDialog() },
    )

    // B3 — room message report dialog (UK OSA per-message reporting).
    // Shown when a non-self TEXT message is long-pressed. The dialog itself
    // lives in core/ui so DM and room use one identical surface; only the
    // VM hop differs (RoomViewModel.reportMessage vs PrivateChatViewModel).
    reportingRoomMessage?.let { msg ->
        com.shyden.shytalk.core.ui.ReportMessageDialog(
            onDismiss = { reportingRoomMessage = null },
            onSubmit = { reason, description ->
                viewModel.reportMessage(msg, reason, description)
                reportingRoomMessage = null
            },
        )
    }
}
