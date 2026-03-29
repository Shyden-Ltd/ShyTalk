package com.shyden.shytalk.feature.messaging

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.material3.rememberModalBottomSheetState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf

@Suppress("kotlin:S107")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun PmBottomSheet(
    onDismiss: () -> Unit,
    preOpenUserId: String? = null,
    preOpenGroupConversationId: String? = null,
    onPickImages: ((PrivateChatViewModel) -> Unit)? = null,
    onPickStickerImage: ((PrivateChatViewModel) -> Unit)? = null,
    onNavigateToRoom: ((String) -> Unit)? = null,
    activeRoomId: String? = null,
    activeRoomName: String? = null,
) {
    val sheetState = rememberModalBottomSheetState(skipPartiallyExpanded = true)
    var selectedChatUserId by remember { mutableStateOf(preOpenUserId) }
    var selectedGroupConversationId by remember { mutableStateOf(preOpenGroupConversationId) }

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetState = sheetState,
    ) {
        val groupId = selectedGroupConversationId
        val chatUserId = selectedChatUserId
        when {
            groupId != null -> {
                // Group chat view
                PmSheetGroupChatView(
                    conversationId = groupId,
                    onBack = { selectedGroupConversationId = null },
                    onPickImages = onPickImages,
                    onPickStickerImage = onPickStickerImage,
                    onNavigateToRoom = onNavigateToRoom,
                    activeRoomId = activeRoomId,
                    activeRoomName = activeRoomName,
                )
            }
            chatUserId != null -> {
                // 1-on-1 chat view
                PmSheetChatView(
                    otherUserId = chatUserId,
                    onBack = { selectedChatUserId = null },
                    onPickImages = onPickImages,
                    onPickStickerImage = onPickStickerImage,
                    onNavigateToRoom = onNavigateToRoom,
                    activeRoomId = activeRoomId,
                    activeRoomName = activeRoomName,
                )
            }
            else -> {
                // Conversation list view
                PmSheetListView(
                    onSelectConversation = { userId -> selectedChatUserId = userId },
                    onSelectGroupConversation = { conversationId -> selectedGroupConversationId = conversationId },
                )
            }
        }
    }
}

@Composable
private fun PmSheetListView(
    onSelectConversation: (String) -> Unit,
    onSelectGroupConversation: (String) -> Unit = {},
    viewModel: ConversationListViewModel = koinViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.7f),
    ) {
        Row(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
            verticalAlignment = Alignment.CenterVertically,
        ) {
            Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null)
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = stringResource(Res.string.messages_title),
                style = MaterialTheme.typography.titleMedium,
            )
        }
        HorizontalDivider()

        val conversations = viewModel.getFilteredConversations()
        if (uiState.isLoading) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }
        } else if (conversations.isEmpty()) {
            Text(
                text = stringResource(Res.string.no_conversations_yet),
                style = MaterialTheme.typography.bodyMedium,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
                modifier = Modifier.padding(16.dp),
            )
        } else {
            LazyColumn {
                items(
                    items = conversations,
                    key = { it.conversation.conversationId },
                ) { cw ->
                    ConversationListItem(
                        otherUser = cw.otherUser,
                        lastMessageText = cw.conversation.lastMessage?.text,
                        lastMessageType = cw.conversation.lastMessage?.type,
                        lastMessageAt = cw.conversation.lastMessageAt,
                        unreadCount = cw.settings?.unreadCount ?: 0,
                        isMuted = cw.settings?.isMuted == true,
                        isPinned = cw.settings?.isPinned == true,
                        isGroup = cw.isGroup,
                        groupName = cw.groupName,
                        groupPhotoUrl = cw.groupPhotoUrl,
                        onClick = {
                            viewModel.markConversationRead(cw.conversation.conversationId)
                            if (cw.isGroup) {
                                onSelectGroupConversation(cw.conversation.conversationId)
                            } else {
                                val otherUserId = cw.conversation.otherUserId(viewModel.currentUserId) ?: return@ConversationListItem
                                onSelectConversation(otherUserId)
                            }
                        },
                        aliases = uiState.aliases,
                    )
                    HorizontalDivider(modifier = Modifier.padding(start = 80.dp))
                }
            }
        }
    }
}

@Suppress("kotlin:S107")
@Composable
private fun PmSheetChatView(
    otherUserId: String,
    onBack: () -> Unit,
    onPickImages: ((PrivateChatViewModel) -> Unit)? = null,
    onPickStickerImage: ((PrivateChatViewModel) -> Unit)? = null,
    onNavigateToRoom: ((String) -> Unit)? = null,
    activeRoomId: String? = null,
    activeRoomName: String? = null,
    viewModel: PrivateChatViewModel = koinViewModel(key = otherUserId) { parametersOf(otherUserId) },
) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.7f),
    ) {
        PrivateChatScreen(
            otherUserId = otherUserId,
            onNavigateBack = onBack,
            onPickImages =
                if (onPickImages != null) {
                    { onPickImages(viewModel) }
                } else {
                    null
                },
            onPickStickerImage =
                if (onPickStickerImage != null) {
                    { onPickStickerImage(viewModel) }
                } else {
                    null
                },
            onNavigateToRoom = onNavigateToRoom,
            activeRoomId = activeRoomId,
            activeRoomName = activeRoomName,
            viewModel = viewModel,
        )
    }
}

@Suppress("kotlin:S107")
@Composable
private fun PmSheetGroupChatView(
    conversationId: String,
    onBack: () -> Unit,
    onPickImages: ((PrivateChatViewModel) -> Unit)? = null,
    onPickStickerImage: ((PrivateChatViewModel) -> Unit)? = null,
    onNavigateToRoom: ((String) -> Unit)? = null,
    activeRoomId: String? = null,
    activeRoomName: String? = null,
    viewModel: PrivateChatViewModel = koinViewModel(key = conversationId) { parametersOf("", conversationId) },
) {
    Box(
        modifier =
            Modifier
                .fillMaxWidth()
                .fillMaxHeight(0.7f),
    ) {
        PrivateChatScreen(
            conversationId = conversationId,
            onNavigateBack = onBack,
            onPickImages =
                if (onPickImages != null) {
                    { onPickImages(viewModel) }
                } else {
                    null
                },
            onPickStickerImage =
                if (onPickStickerImage != null) {
                    { onPickStickerImage(viewModel) }
                } else {
                    null
                },
            onNavigateToRoom = onNavigateToRoom,
            activeRoomId = activeRoomId,
            activeRoomName = activeRoomName,
            viewModel = viewModel,
        )
    }
}
