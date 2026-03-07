package com.shyden.shytalk.feature.messaging

import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.fadeOut
import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Close
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
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.DpOffset
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.*
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle

@OptIn(ExperimentalFoundationApi::class, ExperimentalMaterial3Api::class)
@Composable
fun ConversationListScreen(
    onNavigateToChat: (String) -> Unit,
    onNavigateToGroupChat: (String) -> Unit = {},
    modifier: Modifier = Modifier,
    viewModel: ConversationListViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    var showSearch by remember { mutableStateOf(false) }
    var contextMenuConversationId by remember { mutableStateOf<String?>(null) }
    var showDeleteConfirm by remember { mutableStateOf<String?>(null) }

    Column(modifier = modifier.fillMaxSize()) {
        // Search bar
        AnimatedVisibility(
            visible = showSearch,
            enter = fadeIn(),
            exit = fadeOut()
        ) {
            OutlinedTextField(
                value = uiState.searchQuery,
                onValueChange = { viewModel.onSearchQueryChanged(it) },
                placeholder = { Text(stringResource(Res.string.search_conversations)) },
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp, vertical = 8.dp),
                singleLine = true,
                leadingIcon = {
                    Icon(Icons.Default.Search, contentDescription = null)
                },
                trailingIcon = {
                    IconButton(onClick = {
                        viewModel.onSearchQueryChanged("")
                        showSearch = false
                    }) {
                        Icon(Icons.Default.Close, contentDescription = stringResource(Res.string.close))
                    }
                }
            )
        }

        if (uiState.isLoading) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else {
            val conversations = viewModel.getFilteredConversations()

            PullToRefreshBox(
                isRefreshing = uiState.isRefreshing,
                onRefresh = { viewModel.refreshConversations() },
                modifier = Modifier.weight(1f)
            ) {
                if (conversations.isEmpty()) {
                    // Empty state
                    Box(
                        modifier = Modifier
                            .fillMaxSize()
                            .verticalScroll(rememberScrollState())
                            .testTag("conversationList_emptyState"),
                        contentAlignment = Alignment.Center
                    ) {
                        Column(
                            horizontalAlignment = Alignment.CenterHorizontally,
                            verticalArrangement = Arrangement.spacedBy(8.dp)
                        ) {
                            Icon(
                                Icons.AutoMirrored.Filled.Chat,
                                contentDescription = null,
                                modifier = Modifier.size(64.dp),
                                tint = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
                            )
                            Text(
                                text = if (uiState.searchQuery.isNotBlank()) stringResource(Res.string.no_matches_found) else stringResource(Res.string.no_messages),
                                style = MaterialTheme.typography.titleMedium,
                                color = MaterialTheme.colorScheme.onSurfaceVariant
                            )
                            if (uiState.searchQuery.isBlank()) {
                                Text(
                                    text = stringResource(Res.string.conversation_start_hint),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.7f),
                                    textAlign = TextAlign.Center
                                )
                            }
                        }
                    }
                } else {
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        items(
                            items = conversations,
                            key = { it.conversation.conversationId }
                        ) { conversationWithUser ->
                            val cId = conversationWithUser.conversation.conversationId
                            Box {
                                val navigateAction = {
                                    viewModel.markConversationRead(cId)
                                    if (conversationWithUser.isGroup) {
                                        onNavigateToGroupChat(cId)
                                    } else {
                                        val otherUserId = conversationWithUser.conversation.otherUserId(viewModel.currentUserId)
                                        if (otherUserId != null) onNavigateToChat(otherUserId)
                                    }
                                }

                                ConversationListItem(
                                    otherUser = conversationWithUser.otherUser,
                                    lastMessageText = conversationWithUser.conversation.lastMessage?.text,
                                    lastMessageType = conversationWithUser.conversation.lastMessage?.type,
                                    lastMessageAt = conversationWithUser.conversation.lastMessageAt,
                                    unreadCount = conversationWithUser.settings?.unreadCount ?: 0,
                                    isMuted = conversationWithUser.settings?.isMuted == true,
                                    isPinned = conversationWithUser.settings?.isPinned == true,
                                    onClick = { navigateAction() },
                                    isGroup = conversationWithUser.isGroup,
                                    groupName = conversationWithUser.groupName,
                                    groupPhotoUrl = conversationWithUser.groupPhotoUrl,
                                    currentUserRole = if (conversationWithUser.isGroup) {
                                        conversationWithUser.conversation.roleOf(viewModel.currentUserId)
                                    } else {
                                        com.shyden.shytalk.core.model.GroupRole.MEMBER
                                    },
                                    aliases = uiState.aliases,
                                    modifier = Modifier.combinedClickable(
                                        onClick = { navigateAction() },
                                        onLongClick = {
                                            contextMenuConversationId = cId
                                        }
                                    )
                                )

                                // Context menu
                                DropdownMenu(
                                    expanded = contextMenuConversationId == cId,
                                    onDismissRequest = { contextMenuConversationId = null },
                                    offset = DpOffset(x = 200.dp, y = 0.dp)
                                ) {
                                    val isPinned = conversationWithUser.settings?.isPinned == true
                                    DropdownMenuItem(
                                        text = { Text(if (isPinned) stringResource(Res.string.unpin) else stringResource(Res.string.pin)) },
                                        onClick = {
                                            contextMenuConversationId = null
                                            viewModel.pinConversation(cId)
                                        }
                                    )
                                    if (!conversationWithUser.isGroup) {
                                        DropdownMenuItem(
                                            text = { Text(stringResource(Res.string.delete_conversation)) },
                                            onClick = {
                                                contextMenuConversationId = null
                                                showDeleteConfirm = cId
                                            }
                                        )
                                    }
                                }
                            }
                            HorizontalDivider(modifier = Modifier.padding(start = 80.dp))
                        }
                    }
                }
            }
        }
    }

    // Delete confirmation dialog
    showDeleteConfirm?.let { conversationId ->
        AlertDialog(
            onDismissRequest = { showDeleteConfirm = null },
            title = { Text(stringResource(Res.string.delete_conversation)) },
            text = { Text(stringResource(Res.string.delete_conversation_warning)) },
            confirmButton = {
                TextButton(onClick = {
                    viewModel.hideConversation(conversationId)
                    showDeleteConfirm = null
                }) {
                    Text(stringResource(Res.string.delete), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showDeleteConfirm = null }) {
                    Text(stringResource(Res.string.cancel))
                }
            }
        )
    }
}
