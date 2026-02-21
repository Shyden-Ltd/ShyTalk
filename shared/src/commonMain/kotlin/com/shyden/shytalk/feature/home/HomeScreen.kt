package com.shyden.shytalk.feature.home

import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.lazy.rememberLazyListState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Card
import androidx.compose.material3.CardDefaults
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
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import org.koin.compose.viewmodel.koinViewModel
import androidx.compose.runtime.collectAsState
import com.shyden.shytalk.ui.theme.CnyGold

private val BannerBackground = Color(0xFF2A0808)

@Composable
private fun CnyBanner(onClick: () -> Unit) {
    Card(
        shape = RoundedCornerShape(12.dp),
        colors = CardDefaults.cardColors(
            containerColor = BannerBackground
        ),
        border = BorderStroke(1.dp, CnyGold),
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
    ) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "\uD83C\uDFEE",
                    style = MaterialTheme.typography.headlineMedium
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "\uD83D\uDC0E",
                    style = MaterialTheme.typography.headlineLarge
                )
                Spacer(modifier = Modifier.width(4.dp))
                Text(
                    text = "\uD83E\uDDE8",
                    style = MaterialTheme.typography.headlineMedium
                )
                Spacer(modifier = Modifier.width(8.dp))
                Column(modifier = Modifier.weight(1f)) {
                    Text(
                        text = "Happy New Year!",
                        style = MaterialTheme.typography.titleSmall,
                        color = CnyGold
                    )
                    Text(
                        text = "Year of the Horse 2026",
                        style = MaterialTheme.typography.bodySmall,
                        color = CnyGold.copy(alpha = 0.85f)
                    )
                }
                Text(
                    text = "\uD83C\uDFEE",
                    style = MaterialTheme.typography.headlineMedium
                )
            }
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "\u606D\u559C\u767C\u8CA1",
                style = MaterialTheme.typography.titleMedium,
                color = CnyGold
            )
            Text(
                text = "Gong Xi Fa Cai! \u2022 Tap to learn more",
                style = MaterialTheme.typography.labelSmall,
                color = CnyGold.copy(alpha = 0.7f)
            )
        }
    }
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun RoomListContent(
    onNavigateToRoom: (String) -> Unit,
    onNavigateToLunarNewYear: () -> Unit = {},
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
                item(key = "banner_carousel") {
                    BannerCarousel(
                        banners = listOf(
                            BannerItem(
                                key = "cny",
                                content = { CnyBanner(onClick = onNavigateToLunarNewYear) },
                            ),
                        ),
                        modifier = Modifier.padding(horizontal = 16.dp, vertical = 8.dp),
                    )
                }

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
                            onClick = { onNavigateToRoom(room.roomId) },
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
