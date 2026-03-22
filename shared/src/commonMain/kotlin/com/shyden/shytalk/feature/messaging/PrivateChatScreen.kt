package com.shyden.shytalk.feature.messaging

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.consumeWindowInsets
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.imePadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.Send
import androidx.compose.material.icons.automirrored.filled.VolumeOff
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.EmojiEmotions
import androidx.compose.material.icons.filled.Group
import androidx.compose.material.icons.filled.Image
import androidx.compose.material.icons.filled.MoreVert
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Search
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.DropdownMenu
import androidx.compose.material3.DropdownMenuItem
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.setValue
import androidx.compose.runtime.snapshotFlow
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.window.Dialog
import androidx.compose.ui.window.DialogProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.MessageEdit
import com.shyden.shytalk.core.model.PrivateMessage
import com.shyden.shytalk.core.ui.StyledDisplayName
import com.shyden.shytalk.core.ui.StyledSnackbarHost
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.formatRelativeTime
import com.shyden.shytalk.core.util.isKeyboardVisible
import com.shyden.shytalk.core.util.rememberRelativeTimeStrings
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.ui.theme.SpeakingGreen
import kotlinx.coroutines.delay
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf
import kotlin.time.Instant

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PrivateChatScreen(
    otherUserId: String = "",
    onNavigateBack: () -> Unit,
    onNavigateToUserProfile: (String) -> Unit = {},
    onPickImages: (() -> Unit)? = null,
    onPickStickerImage: (() -> Unit)? = null,
    onNavigateToRoom: ((String) -> Unit)? = null,
    activeRoomId: String? = null,
    activeRoomName: String? = null,
    conversationId: String? = null,
    modifier: Modifier = Modifier,
    viewModel: PrivateChatViewModel = koinViewModel(key = conversationId ?: otherUserId) { parametersOf(otherUserId) },
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    val scope = rememberCoroutineScope()
    val listState = rememberLazyListState()
    val timeStrings = rememberRelativeTimeStrings()

    var messageText by remember { mutableStateOf("") }
    var showOverflowMenu by remember { mutableStateOf(false) }
    var showEditHistory by remember { mutableStateOf<Pair<String, String>?>(null) } // messageId, currentText
    var editHistoryData by remember { mutableStateOf<List<MessageEdit>>(emptyList()) }
    var reportingMessage by remember { mutableStateOf<PrivateMessage?>(null) }
    var showImageViewer by remember { mutableStateOf<Pair<List<String>, Int>?>(null) }
    var showGroupSettings by remember { mutableStateOf(false) }

    // Close sticker picker when navigating away
    DisposableEffect(Unit) {
        onDispose { viewModel.closeStickerPicker() }
    }

    // Scroll to the most recent message on initial load
    var hasScrolledToBottom by remember { mutableStateOf(false) }
    LaunchedEffect(uiState.messages.size) {
        if (uiState.messages.isNotEmpty() && !hasScrolledToBottom) {
            listState.scrollToItem(uiState.messages.size - 1)
            hasScrolledToBottom = true
        }
    }

    // Always scroll to bottom when new messages arrive (sent or received)
    LaunchedEffect(uiState.messages.size, uiState.messages.lastOrNull()?.messageId) {
        if (uiState.messages.isNotEmpty() && hasScrolledToBottom) {
            listState.animateScrollToItem(uiState.messages.size - 1)
        }
    }

    // Re-scroll when room invite previews load (bubble height changes)
    LaunchedEffect(uiState.roomInvites.size) {
        if (uiState.roomInvites.isNotEmpty() && uiState.messages.isNotEmpty() && hasScrolledToBottom) {
            listState.animateScrollToItem(uiState.messages.size - 1)
        }
    }

    // Scroll to bottom when the keyboard opens so the latest messages stay visible
    val isKeyboardVisible = isKeyboardVisible()
    LaunchedEffect(isKeyboardVisible) {
        if (isKeyboardVisible && uiState.messages.isNotEmpty() && hasScrolledToBottom) {
            delay(400) // Wait for IME animation to complete before scrolling
            listState.animateScrollToItem(uiState.messages.size - 1)
        }
    }

    // Load older messages when scrolled to top
    LaunchedEffect(listState) {
        snapshotFlow { listState.firstVisibleItemIndex }
            .collect { index ->
                if (index <= 1 && uiState.hasOlderMessages && !uiState.isLoadingOlder) {
                    viewModel.loadOlderMessages()
                }
            }
    }

    // Mark messages as read when viewing
    LaunchedEffect(uiState.messages.size, uiState.messages.lastOrNull()?.messageId) {
        viewModel.markMessagesAsRead()
    }

    // Pre-populate text field when editing
    LaunchedEffect(uiState.editingMessageId) {
        if (uiState.editingMessageId != null) {
            messageText = uiState.editingOriginalText
        }
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    // Fetch edit history when requested
    LaunchedEffect(showEditHistory) {
        showEditHistory?.let { (messageId, _) ->
            editHistoryData = viewModel.getEditHistory(messageId)
        }
    }

    val otherUser = uiState.otherUser
    val isOnline =
        !uiState.isSystemConversation &&
            otherUser?.hideOnlineStatus != true &&
            (otherUser?.lastSeenAt ?: 0) > currentTimeMillis() - Constants.ONLINE_THRESHOLD_MS

    Scaffold(
        snackbarHost = { StyledSnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                navigationIcon = {
                    IconButton(
                        onClick = onNavigateBack,
                        modifier = Modifier.testTag("privateChat_backButton"),
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back))
                    }
                },
                title = {
                    if (uiState.isGroup) {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Surface(
                                modifier = Modifier.size(36.dp),
                                shape = CircleShape,
                                color = MaterialTheme.colorScheme.primaryContainer,
                            ) {
                                Icon(
                                    Icons.Default.Group,
                                    contentDescription = null,
                                    modifier = Modifier.padding(8.dp),
                                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                                )
                            }
                            Spacer(modifier = Modifier.width(12.dp))
                            Column {
                                Text(
                                    text = uiState.conversationName,
                                    style = MaterialTheme.typography.titleMedium,
                                    maxLines = 1,
                                    overflow = TextOverflow.Ellipsis,
                                )
                                Text(
                                    text = stringResource(Res.string.members_count, uiState.groupParticipants.size),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    } else {
                        Row(
                            modifier =
                                if (!uiState.isSystemConversation) {
                                    Modifier.clickable { otherUser?.uid?.let { onNavigateToUserProfile(it) } }
                                } else {
                                    Modifier
                                },
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            // Avatar
                            val photoUrl = otherUser?.photoUrl
                            if (photoUrl != null) {
                                AsyncImage(
                                    model = photoUrl,
                                    contentDescription = otherUser.displayName,
                                    modifier =
                                        Modifier
                                            .size(36.dp)
                                            .clip(CircleShape),
                                    contentScale = ContentScale.Crop,
                                )
                            } else {
                                Surface(
                                    modifier = Modifier.size(36.dp),
                                    shape = CircleShape,
                                    color = MaterialTheme.colorScheme.primaryContainer,
                                ) {
                                    Icon(
                                        Icons.Default.Person,
                                        contentDescription = null,
                                        modifier = Modifier.padding(8.dp),
                                        tint = MaterialTheme.colorScheme.onPrimaryContainer,
                                    )
                                }
                            }
                            Spacer(modifier = Modifier.width(12.dp))
                            Column {
                                val resolvedName =
                                    otherUser?.uid?.let { uiState.aliases[it] }
                                        ?: otherUser?.displayName ?: stringResource(Res.string.chat)
                                StyledDisplayName(
                                    displayName = resolvedName,
                                    isSuperShy = otherUser?.isSuperShy == true,
                                    style = MaterialTheme.typography.titleMedium,
                                )
                                if (uiState.isOtherUserTyping) {
                                    Text(
                                        text = stringResource(Res.string.typing),
                                        style = MaterialTheme.typography.bodySmall,
                                        color = SpeakingGreen,
                                    )
                                } else if (otherUser?.hideOnlineStatus != true && !uiState.isSystemConversation) {
                                    Text(
                                        text =
                                            if (isOnline) {
                                                stringResource(Res.string.online)
                                            } else {
                                                otherUser?.lastSeenAt?.let {
                                                    stringResource(
                                                        Res.string.last_seen,
                                                        formatRelativeTime(it, timeStrings),
                                                    )
                                                }
                                                    ?: ""
                                            },
                                        style = MaterialTheme.typography.bodySmall,
                                        color = if (isOnline) SpeakingGreen else MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }
                    }
                },
                actions = {
                    IconButton(onClick = { viewModel.toggleSearch() }) {
                        Icon(Icons.Default.Search, contentDescription = null)
                    }
                    if (!uiState.isSystemConversation) {
                        Box {
                            IconButton(onClick = { showOverflowMenu = true }) {
                                Icon(Icons.Default.MoreVert, contentDescription = null)
                            }
                            DropdownMenu(
                                expanded = showOverflowMenu,
                                onDismissRequest = { showOverflowMenu = false },
                            ) {
                                DropdownMenuItem(
                                    text = {
                                        Text(
                                            if (uiState.isMuted) {
                                                stringResource(
                                                    Res.string.unmute_notifications,
                                                )
                                            } else {
                                                stringResource(Res.string.mute_notifications)
                                            },
                                        )
                                    },
                                    onClick = {
                                        showOverflowMenu = false
                                        viewModel.toggleMute()
                                    },
                                )
                                DropdownMenuItem(
                                    text = {
                                        Text(
                                            if (uiState.isPinned) stringResource(Res.string.unpin) else stringResource(Res.string.pin),
                                        )
                                    },
                                    onClick = {
                                        showOverflowMenu = false
                                        viewModel.togglePin()
                                    },
                                )
                                if (uiState.isGroup) {
                                    DropdownMenuItem(
                                        text = { Text(stringResource(Res.string.group_settings)) },
                                        onClick = {
                                            showOverflowMenu = false
                                            showGroupSettings = true
                                        },
                                    )
                                }
                                if (!uiState.isGroup) {
                                    DropdownMenuItem(
                                        text = { Text(stringResource(Res.string.view_profile)) },
                                        onClick = {
                                            showOverflowMenu = false
                                            otherUser?.uid?.let { onNavigateToUserProfile(it) }
                                        },
                                    )
                                }
                                if (activeRoomId != null) {
                                    val roomFallback = stringResource(Res.string.room)
                                    DropdownMenuItem(
                                        text = { Text(stringResource(Res.string.invite_to_room)) },
                                        onClick = {
                                            showOverflowMenu = false
                                            viewModel.sendRoomInvite(activeRoomId, activeRoomName ?: roomFallback)
                                        },
                                    )
                                }
                                if (!uiState.isGroup) {
                                    HorizontalDivider()
                                    DropdownMenuItem(
                                        text = {
                                            Text(
                                                stringResource(Res.string.delete_conversation),
                                                color = MaterialTheme.colorScheme.error,
                                            )
                                        },
                                        onClick = {
                                            showOverflowMenu = false
                                            viewModel.hideConversation()
                                            onNavigateBack()
                                        },
                                    )
                                }
                            }
                        }
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier =
                modifier
                    .fillMaxSize()
                    .padding(padding)
                    .consumeWindowInsets(padding)
                    .imePadding(),
        ) {
            // Blocked banner
            if (uiState.isBlocked) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.errorContainer,
                ) {
                    Text(
                        text = uiState.blockReason ?: stringResource(Res.string.cant_message_user),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onErrorContainer,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }
            }

            // Search bar
            if (uiState.isSearching) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    tonalElevation = 2.dp,
                ) {
                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        OutlinedTextField(
                            value = uiState.searchQuery,
                            onValueChange = { viewModel.searchMessages(it) },
                            placeholder = { Text(stringResource(Res.string.search_messages)) },
                            modifier = Modifier.weight(1f),
                            singleLine = true,
                            shape = RoundedCornerShape(24.dp),
                            leadingIcon = { Icon(Icons.Default.Search, contentDescription = null) },
                        )
                        IconButton(onClick = { viewModel.toggleSearch() }) {
                            Icon(Icons.Default.Close, contentDescription = stringResource(Res.string.close))
                        }
                    }
                }
                if (uiState.searchResults.isNotEmpty()) {
                    Text(
                        text = stringResource(Res.string.result_count, uiState.searchResults.size),
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 4.dp),
                    )
                }
            }

            if (uiState.isLoading) {
                Box(
                    modifier =
                        Modifier
                            .weight(1f)
                            .fillMaxWidth(),
                    contentAlignment = Alignment.Center,
                ) {
                    CircularProgressIndicator()
                }
            } else {
                // Messages list with pull-to-refresh
                PullToRefreshBox(
                    isRefreshing = uiState.isRefreshing,
                    onRefresh = { viewModel.refreshMessages() },
                    modifier =
                        Modifier
                            .weight(1f)
                            .fillMaxWidth(),
                ) {
                    // Empty state when no messages and not loading
                    val displayMessages =
                        if (uiState.isSearching &&
                            uiState.searchQuery.length >= 2
                        ) {
                            uiState.searchResults
                        } else {
                            uiState.messages
                        }
                    if (displayMessages.isEmpty() && !uiState.isSearching) {
                        Box(
                            modifier = Modifier.fillMaxSize(),
                            contentAlignment = Alignment.Center,
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    text = stringResource(Res.string.no_messages),
                                    style = MaterialTheme.typography.bodyLarge,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Spacer(modifier = Modifier.height(4.dp))
                                Text(
                                    text = stringResource(Res.string.start_conversation),
                                    style = MaterialTheme.typography.bodySmall,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    }

                    LazyColumn(
                        state = listState,
                        modifier = Modifier.fillMaxSize(),
                        reverseLayout = false,
                    ) {
                        // Load more indicator
                        if (uiState.isLoadingOlder) {
                            item {
                                Box(
                                    modifier =
                                        Modifier
                                            .fillMaxWidth()
                                            .padding(8.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    CircularProgressIndicator(modifier = Modifier.size(24.dp))
                                }
                            }
                        }

                        // Date separator logic
                        val messages =
                            if (uiState.isSearching &&
                                uiState.searchQuery.length >= 2
                            ) {
                                uiState.searchResults
                            } else {
                                uiState.messages
                            }
                        val showDateSeparators = uiState.currentUser?.pmShowDateSeparators != false
                        val showTimestamps = uiState.currentUser?.pmShowTimestamps != false

                        items(
                            items = messages,
                            key = { it.messageId },
                        ) { message ->
                            val index = messages.indexOf(message)

                            // Date separator
                            if (showDateSeparators && index > 0) {
                                val prevDate =
                                    Instant
                                        .fromEpochMilliseconds(messages[index - 1].createdAt)
                                        .toLocalDateTime(TimeZone.currentSystemDefault())
                                        .date
                                val currDate =
                                    Instant
                                        .fromEpochMilliseconds(message.createdAt)
                                        .toLocalDateTime(TimeZone.currentSystemDefault())
                                        .date
                                if (prevDate != currDate) {
                                    DateSeparator(message.createdAt)
                                }
                            } else if (showDateSeparators && index == 0) {
                                DateSeparator(message.createdAt)
                            }

                            val isSent = message.senderId == uiState.currentUserId
                            val isRead =
                                message.readBy.contains(
                                    uiState.otherUser?.uid ?: "",
                                )

                            // Show sender name for group messages (received only)
                            if (uiState.isGroup && !isSent) {
                                Text(
                                    text = message.senderName,
                                    style = MaterialTheme.typography.labelSmall,
                                    color = MaterialTheme.colorScheme.primary,
                                    modifier = Modifier.padding(start = 16.dp, top = 4.dp),
                                )
                            }

                            PrivateMessageBubble(
                                message = message,
                                isSent = isSent,
                                isRead = isRead,
                                showTimestamp = showTimestamps,
                                otherUserId = otherUserId,
                                currentUserId = uiState.currentUserId,
                                onEdit = { viewModel.startEditing(message) },
                                onReply = { viewModel.startReply(message) },
                                onViewEditHistory = {
                                    showEditHistory = message.messageId to message.text
                                },
                                onRetry = { /* Failed message retry handled in future phase */ },
                                onReportMessage = { reportingMessage = message },
                                onToggleReaction = { emoji -> viewModel.toggleReaction(message.messageId, emoji) },
                                onImageClick = { urls, index -> showImageViewer = urls to index },
                                onRoomInviteTap = onNavigateToRoom?.let { nav -> { roomId: String -> nav(roomId) } },
                                roomInvitePreview = message.roomInviteId?.let { uiState.roomInvites[it] },
                                onRecall = { viewModel.recallMessage(message.messageId) },
                                onSaveSticker = { url -> viewModel.saveStickerFromUrl(url) },
                                onHideMessage =
                                    if (uiState.isGroup &&
                                        uiState.conversation
                                            ?.permissions
                                            ?.whoCanDeleteMessages
                                            ?.isAllowed(uiState.currentUserRole) == true
                                    ) {
                                        { viewModel.hideMessage(message.messageId) }
                                    } else if (!uiState.isGroup && uiState.isModOrAbove) {
                                        { viewModel.hideMessage(message.messageId) }
                                    } else {
                                        null
                                    },
                                onTranslate =
                                    if (!isSent && message.text.isNotBlank()) {
                                        { viewModel.translateMessage(message.messageId) }
                                    } else {
                                        null
                                    },
                                translatedText = uiState.translations[message.messageId],
                                isModOrAbove = uiState.isModOrAbove,
                                isGroupChat = uiState.isGroup,
                            )
                        }
                    }
                } // PullToRefreshBox
            }

            // Reply preview bar
            uiState.replyingToMessage?.let { replyMsg ->
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    tonalElevation = 2.dp,
                ) {
                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Box(
                            modifier =
                                Modifier
                                    .width(3.dp)
                                    .height(32.dp)
                                    .background(MaterialTheme.colorScheme.primary, RoundedCornerShape(2.dp)),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Column(modifier = Modifier.weight(1f)) {
                            Text(
                                text = stringResource(Res.string.replying_to, replyMsg.senderName),
                                style = MaterialTheme.typography.labelSmall,
                                color = MaterialTheme.colorScheme.primary,
                            )
                            Text(
                                text =
                                    if (replyMsg.imageUrls.isNotEmpty()) {
                                        stringResource(
                                            Res.string.message_preview_image,
                                        )
                                    } else {
                                        replyMsg.text
                                    },
                                style = MaterialTheme.typography.bodySmall,
                                color = MaterialTheme.colorScheme.onSurfaceVariant,
                                maxLines = 1,
                                overflow = TextOverflow.Ellipsis,
                            )
                        }
                        IconButton(onClick = { viewModel.cancelReply() }) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = stringResource(Res.string.cancel),
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }
            }

            // Editing indicator
            if (uiState.editingMessageId != null) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    tonalElevation = 2.dp,
                ) {
                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 12.dp, vertical = 8.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.Default.Edit,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.size(18.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = stringResource(Res.string.editing_message),
                            style = MaterialTheme.typography.labelSmall,
                            color = MaterialTheme.colorScheme.primary,
                            modifier = Modifier.weight(1f),
                        )
                        IconButton(onClick = {
                            viewModel.cancelEditing()
                            messageText = ""
                        }) {
                            Icon(
                                Icons.Default.Close,
                                contentDescription = stringResource(Res.string.cancel),
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }
            }

            // Sticker picker
            if (uiState.showStickerPicker) {
                StickerPicker(
                    stickers = uiState.stickers,
                    onStickerSelected = { sticker ->
                        viewModel.sendSticker(sticker)
                    },
                    onAddSticker = onPickStickerImage,
                    onDeleteSticker = { id -> viewModel.deleteSticker(id) },
                    onMoveToFront = { id -> viewModel.moveStickerToFront(id) },
                )
            }

            // Mute banner (group only)
            val muteInfo = uiState.currentUserMuteInfo
            if (uiState.isGroup && muteInfo != null) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.errorContainer,
                ) {
                    Row(
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.VolumeOff,
                            contentDescription = null,
                            tint = MaterialTheme.colorScheme.onErrorContainer,
                            modifier = Modifier.size(20.dp),
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        val muteText =
                            buildString {
                                if (muteInfo.expiresAt != null) {
                                    val remaining = muteInfo.expiresAt - currentTimeMillis()
                                    if (remaining > 0) {
                                        val mins = remaining / 60000
                                        val hrs = mins / 60
                                        if (hrs > 0) {
                                            append(stringResource(Res.string.muted_for_hours_minutes, hrs.toInt(), (mins % 60).toInt()))
                                        } else {
                                            append(stringResource(Res.string.muted_for_minutes, mins.toInt()))
                                        }
                                    } else {
                                        append(stringResource(Res.string.muted_indefinitely))
                                    }
                                } else {
                                    append(stringResource(Res.string.muted_indefinitely))
                                }
                                muteInfo.reason?.let { append(stringResource(Res.string.mute_reason, it)) }
                            }
                        Text(
                            text = muteText,
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.onErrorContainer,
                        )
                    }
                }
            }

            // Send permission check for groups
            val canSend =
                !uiState.isGroup ||
                    (
                        uiState.conversation
                            ?.permissions
                            ?.whoCanSend
                            ?.isAllowed(uiState.currentUserRole) ?: true
                    )

            // Permission-restricted banner
            if (uiState.isGroup && !canSend && uiState.currentUserMuteInfo == null) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    color = MaterialTheme.colorScheme.surfaceVariant,
                ) {
                    Text(
                        text = stringResource(Res.string.only_admins_can_send),
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 12.dp),
                    )
                }
            }

            // Input row (hidden for blocked users, system conversations, muted users, and permission-restricted)
            if (!uiState.isBlocked && !uiState.isSystemConversation && uiState.currentUserMuteInfo == null && canSend) {
                Surface(
                    modifier = Modifier.fillMaxWidth(),
                    tonalElevation = 3.dp,
                ) {
                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .padding(horizontal = 8.dp, vertical = 4.dp),
                        verticalAlignment = Alignment.Bottom,
                    ) {
                        if (onPickImages != null) {
                            IconButton(
                                onClick = onPickImages,
                                enabled = !uiState.isUploadingImages,
                            ) {
                                if (uiState.isUploadingImages) {
                                    CircularProgressIndicator(modifier = Modifier.size(20.dp))
                                } else {
                                    Icon(Icons.Default.Image, contentDescription = stringResource(Res.string.image))
                                }
                            }
                        }
                        IconButton(
                            onClick = { viewModel.toggleStickerPicker() },
                        ) {
                            Icon(Icons.Default.EmojiEmotions, contentDescription = stringResource(Res.string.sticker))
                        }
                        OutlinedTextField(
                            value = messageText,
                            onValueChange = {
                                if (it.length <= Constants.MAX_PM_MESSAGE_LENGTH) {
                                    messageText = it
                                    if (it.isNotEmpty()) viewModel.onTextChanged()
                                }
                            },
                            placeholder = { Text(stringResource(Res.string.message_ellipsis)) },
                            modifier = Modifier.weight(1f).testTag("privateChat_messageInput"),
                            maxLines = 4,
                            shape = RoundedCornerShape(24.dp),
                        )
                        Spacer(modifier = Modifier.width(4.dp))
                        IconButton(
                            onClick = {
                                val text = messageText.trim()
                                if (text.isNotEmpty()) {
                                    if (uiState.editingMessageId != null) {
                                        viewModel.submitEdit(text)
                                    } else {
                                        viewModel.sendMessage(text)
                                    }
                                    messageText = ""
                                }
                            },
                            enabled = messageText.isNotBlank(),
                            modifier = Modifier.testTag("privateChat_sendButton"),
                        ) {
                            Icon(
                                Icons.AutoMirrored.Filled.Send,
                                contentDescription = stringResource(Res.string.send),
                                tint =
                                    if (messageText.isNotBlank()) {
                                        MaterialTheme.colorScheme.primary
                                    } else {
                                        MaterialTheme.colorScheme.onSurfaceVariant
                                    },
                            )
                        }
                    }
                }
            }
        }
    }

    // Edit history dialog
    showEditHistory?.let { (messageId, currentText) ->
        EditHistoryDialog(
            edits = editHistoryData,
            currentText = currentText,
            onDismiss = {
                showEditHistory = null
                editHistoryData = emptyList()
            },
        )
    }

    // Report dialog
    reportingMessage?.let { msg ->
        ReportMessageDialog(
            onDismiss = { reportingMessage = null },
            onSubmit = { reason, description ->
                viewModel.reportMessage(msg, reason, description)
                reportingMessage = null
            },
        )
    }

    // Fullscreen image viewer
    showImageViewer?.let { (urls, idx) ->
        Dialog(
            onDismissRequest = { showImageViewer = null },
            properties = DialogProperties(usePlatformDefaultWidth = false),
        ) {
            FullscreenImageViewer(
                imageUrls = urls,
                initialIndex = idx,
                onDismiss = { showImageViewer = null },
            )
        }
    }

    // Group settings sheet
    if (showGroupSettings && uiState.isGroup) {
        GroupSettingsSheet(
            conversation = uiState.conversation,
            conversationName = uiState.conversationName,
            participants = uiState.groupParticipants,
            isAdmin = uiState.isAdmin,
            isModOrAbove = uiState.isModOrAbove,
            currentUserRole = uiState.currentUserRole,
            currentUserId = uiState.currentUserId,
            groupMutes = uiState.groupMutes,
            onDismiss = { showGroupSettings = false },
            onUpdateGroupName = { viewModel.updateGroupName(it) },
            onRemoveParticipant = { viewModel.removeGroupParticipant(it) },
            onLeaveGroup = {
                viewModel.leaveGroup()
                showGroupSettings = false
                onNavigateBack()
            },
            onUpdateGroupDescription = { viewModel.updateGroupDescription(it) },
            onUpdateGroupRoles = { adminIds, modIds -> viewModel.updateGroupRoles(adminIds, modIds) },
            onUpdatePermissions = { viewModel.updateGroupPermissions(it) },
            onUpdateSystemMessageConfig = { viewModel.updateSystemMessageConfig(it) },
            onUpdateModNotifyMode = { viewModel.updateModNotifyMode(it) },
            onTransferOwnership = { viewModel.transferOwnership(it) },
            onUnmuteMember = { viewModel.unmuteGroupMember(it) },
            onAddParticipant = { viewModel.addGroupParticipant(it) },
        )
    }
}

private val reportReasons = listOf("Spam", "Harassment", "Inappropriate Content", "Other")

@Composable
private fun ReportMessageDialog(
    onDismiss: () -> Unit,
    onSubmit: (reason: String, description: String) -> Unit,
) {
    var selectedReason by remember { mutableStateOf(reportReasons[0]) }
    var description by remember { mutableStateOf("") }

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(Res.string.report_message)) },
        text = {
            Column {
                Text(
                    text = stringResource(Res.string.report_message_prompt),
                    style = MaterialTheme.typography.bodyMedium,
                )
                Spacer(modifier = Modifier.height(8.dp))
                reportReasons.forEach { reason ->
                    Row(
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .clickable { selectedReason = reason }
                                .padding(vertical = 4.dp),
                        verticalAlignment = Alignment.CenterVertically,
                    ) {
                        RadioButton(
                            selected = selectedReason == reason,
                            onClick = { selectedReason = reason },
                        )
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(text = reason, style = MaterialTheme.typography.bodyMedium)
                    }
                }
                Spacer(modifier = Modifier.height(8.dp))
                OutlinedTextField(
                    value = description,
                    onValueChange = { description = it },
                    placeholder = { Text(stringResource(Res.string.additional_details_optional)) },
                    modifier = Modifier.fillMaxWidth(),
                    maxLines = 3,
                )
            }
        },
        confirmButton = {
            TextButton(onClick = { onSubmit(selectedReason, description) }) {
                Text(stringResource(Res.string.submit_report))
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(Res.string.cancel))
            }
        },
    )
}

@Composable
private fun DateSeparator(timestampMs: Long) {
    val tz = TimeZone.currentSystemDefault()
    val date = Instant.fromEpochMilliseconds(timestampMs).toLocalDateTime(tz).date
    val today = Instant.fromEpochMilliseconds(currentTimeMillis()).toLocalDateTime(tz).date

    val label =
        when {
            date == today -> stringResource(Res.string.today)
            date.toEpochDays() == today.toEpochDays() - 1 -> stringResource(Res.string.yesterday)
            else -> {
                val month =
                    date.month.name
                        .lowercase()
                        .replaceFirstChar { it.uppercase() }
                        .take(3)
                "$month ${date.day}, ${date.year}"
            }
        }

    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp),
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            shape = RoundedCornerShape(12.dp),
            color = MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.6f),
        ) {
            Text(
                text = label,
                style = MaterialTheme.typography.labelSmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(horizontal = 12.dp, vertical = 4.dp),
            )
        }
    }
}
