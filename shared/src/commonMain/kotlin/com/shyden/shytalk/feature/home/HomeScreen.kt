package com.shyden.shytalk.feature.home

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.koin.compose.viewmodel.koinViewModel
import androidx.compose.runtime.collectAsState
import com.shyden.shytalk.core.model.ChatRoom

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomListContent(
    onNavigateToRoom: (String) -> Unit,
    onPrewarmRoom: (ChatRoom) -> Unit = {},
    snackbarHostState: SnackbarHostState,
    showCreateDialog: Boolean,
    onDismissCreateDialog: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: HomeViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()

    DisposableEffect(Unit) {
        viewModel.setActive(true)
        onDispose { viewModel.setActive(false) }
    }

    LaunchedEffect(uiState.createdRoomId) {
        uiState.createdRoomId?.let { roomId ->
            viewModel.onRoomNavigated()
            onNavigateToRoom(roomId)
        }
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    PullToRefreshBox(
        isRefreshing = uiState.isRefreshing,
        onRefresh = { viewModel.refreshRooms() },
        modifier = modifier.fillMaxSize()
    ) {
        if (uiState.isLoading) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center
            ) {
                CircularProgressIndicator()
            }
        } else {
            LazyColumn(
                state = listState,
                modifier = Modifier.fillMaxSize()
            ) {
                if (uiState.rooms.isEmpty()) {
                    item {
                        Box(
                            modifier = Modifier
                                .fillParentMaxSize()
                                .testTag("roomList_emptyState"),
                            contentAlignment = Alignment.Center
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally
                            ) {
                                Text(
                                    text = "No active rooms",
                                    style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                                Text(
                                    text = "Tap + to create one",
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                } else {
                    items(uiState.rooms, key = { it.roomId }) { room ->
                        RoomListItem(
                            room = room,
                            seatUsers = uiState.seatUsers,
                            onClick = {
                                onPrewarmRoom(room)
                                onNavigateToRoom(room.roomId)
                            },
                            modifier = Modifier.testTag("roomList_roomCard_${room.roomId}")
                        )
                    }
                }
            }
        }
    }

    if (showCreateDialog) {
        CreateRoomDialog(
            onDismiss = onDismissCreateDialog,
            onCreate = { name ->
                onDismissCreateDialog()
                viewModel.createRoom(name)
            },
            initialRoomName = uiState.lastRoomName
        )
    }
}
