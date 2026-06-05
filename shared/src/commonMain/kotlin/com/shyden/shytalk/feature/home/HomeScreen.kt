package com.shyden.shytalk.feature.home

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.pulltorefresh.PullToRefreshBox
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.Banner
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.push.PushPermissionState
import com.shyden.shytalk.core.push.PushPermissionStore
import com.shyden.shytalk.core.ui.PushPermissionDeniedBanner
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

@Suppress("kotlin:S107")
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomListContent(
    onNavigateToRoom: (String) -> Unit,
    onPrewarmRoom: (ChatRoom) -> Unit = {},
    onBannerAction: (Banner) -> Unit = {},
    snackbarHostState: SnackbarHostState,
    showCreateDialog: Boolean,
    onDismissCreateDialog: () -> Unit,
    modifier: Modifier = Modifier,
    viewModel: HomeViewModel = koinViewModel(),
) {
    val uiState by viewModel.uiState.collectAsState()
    val listState = rememberLazyListState()

    DisposableEffect(Unit) {
        viewModel.setActive(true)
        onDispose { viewModel.setActive(false) }
    }

    LaunchedEffect(uiState.createdRoomId) {
        uiState.createdRoomId?.let { roomId ->
            onNavigateToRoom(roomId)
            viewModel.onRoomNavigated()
        }
    }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Box(modifier = modifier.fillMaxSize()) {
        if (uiState.isLoading || uiState.createdRoomId != null) {
            Box(
                modifier = Modifier.fillMaxSize(),
                contentAlignment = Alignment.Center,
            ) {
                CircularProgressIndicator()
            }
        } else {
            Column(modifier = Modifier.fillMaxSize()) {
                // Push-permission denial banner — closes AppDelegate.swift:38's
                // TODO(v2). Shown when the OS reports the permission as DENIED
                // (user has actively denied OR Focus/DnD/parental-control has
                // blocked it). State comes through HomeUiState (folded from
                // PushPermissionStore by HomeViewModel) to keep the MVVM
                // boundary intact; the tap action still defers to the store
                // because the bridge is the actual platform-side actor.
                if (uiState.pushPermissionState == PushPermissionState.DENIED) {
                    PushPermissionDeniedBanner(
                        onOpenSettings = { PushPermissionStore.openSystemSettings() },
                    )
                }
                if (uiState.banners.isNotEmpty()) {
                    BannerCarousel(
                        banners =
                            uiState.banners.map { banner ->
                                BannerItem(
                                    key = banner.id,
                                    onClick = { onBannerAction(banner) },
                                    content = {
                                        AsyncImage(
                                            model = banner.imageUrl,
                                            contentDescription = banner.title,
                                            modifier =
                                                Modifier
                                                    .fillMaxWidth()
                                                    .height(160.dp)
                                                    .clip(RoundedCornerShape(12.dp)),
                                            contentScale = ContentScale.Crop,
                                        )
                                    },
                                )
                            },
                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 8.dp),
                    )
                }
                PullToRefreshBox(
                    isRefreshing = uiState.isRefreshing,
                    onRefresh = { viewModel.refreshRooms() },
                    modifier = Modifier.weight(1f),
                ) {
                    if (uiState.rooms.isEmpty()) {
                        Box(
                            modifier =
                                Modifier
                                    .fillMaxSize()
                                    .verticalScroll(rememberScrollState())
                                    .testTag("roomList_emptyState"),
                            contentAlignment = Alignment.Center,
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                            ) {
                                Text(
                                    text = stringResource(Res.string.no_active_rooms),
                                    style = MaterialTheme.typography.titleMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                                Text(
                                    text = stringResource(Res.string.tap_plus_to_create),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                                )
                            }
                        }
                    } else {
                        LazyColumn(
                            state = listState,
                            verticalArrangement = Arrangement.Top,
                            modifier = Modifier.fillMaxSize(),
                        ) {
                            items(uiState.rooms, key = { it.roomId }) { room ->
                                RoomListItem(
                                    room = room,
                                    seatUsers = uiState.seatUsers,
                                    onClick = {
                                        onPrewarmRoom(room)
                                        onNavigateToRoom(room.roomId)
                                    },
                                    modifier = Modifier.testTag("roomList_roomCard_${room.roomId}"),
                                )
                            }
                        }
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
            initialRoomName = uiState.lastRoomName,
        )
    }

    if (uiState.showReplaceRoomConfirmation) {
        AlertDialog(
            onDismissRequest = { viewModel.cancelReplaceRoom() },
            title = { Text(stringResource(Res.string.replace_room_title)) },
            text = { Text(stringResource(Res.string.replace_room_message)) },
            confirmButton = {
                TextButton(onClick = { viewModel.confirmReplaceRoom() }) {
                    Text(stringResource(Res.string.replace_room_confirm))
                }
            },
            dismissButton = {
                TextButton(onClick = { viewModel.cancelReplaceRoom() }) {
                    Text(stringResource(Res.string.cancel))
                }
            },
        )
    }
}
