package com.shyden.shytalk.feature.main

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.Chat
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Edit
import androidx.compose.material.icons.filled.MeetingRoom
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.FloatingActionButton
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.NavigationBar
import androidx.compose.material3.NavigationBarItem
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import com.shyden.shytalk.core.model.BannerActionType
import com.shyden.shytalk.core.model.ChatRoom
import com.shyden.shytalk.core.ui.DegradedModeBanner
import com.shyden.shytalk.feature.home.RoomListContent

enum class BottomNavTab(val label: String) {
    Rooms("Rooms"),
    Messages("Messages"),
    Profile("Profile")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    isBackendDegraded: Boolean = false,
    onNavigateToRoom: (String) -> Unit,
    onPrewarmRoom: (ChatRoom) -> Unit = {},
    onNavigateToUserProfile: (String) -> Unit,
    onNavigateToFollowList: (String, String) -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToNewMessage: () -> Unit = {},
    onNavigateToWallet: () -> Unit = {},
    onNavigateToUrl: (String) -> Unit = {},
    messagesContent: @Composable (Modifier) -> Unit = {},
    totalUnreadCount: Long = 0,
    profileContent: @Composable (Modifier) -> Unit
) {
    var selectedTabName by rememberSaveable { mutableStateOf(BottomNavTab.Rooms.name) }
    val selectedTab = BottomNavTab.valueOf(selectedTabName)
    var showCreateDialog by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }
    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = {
                    Text(
                        when (selectedTab) {
                            BottomNavTab.Rooms -> "Rooms"
                            BottomNavTab.Messages -> "Messages"
                            BottomNavTab.Profile -> "Profile"
                        }
                    )
                },
                actions = {
                    if (selectedTab == BottomNavTab.Profile) {
                        IconButton(onClick = onNavigateToSettings, modifier = Modifier.testTag("main_settingsButton")) {
                            Icon(Icons.Default.Settings, contentDescription = "Settings")
                        }
                    }
                }
            )
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = selectedTab == BottomNavTab.Rooms,
                    onClick = { selectedTabName = BottomNavTab.Rooms.name },
                    icon = { Icon(Icons.Default.MeetingRoom, contentDescription = null) },
                    label = { Text("Rooms") },
                    modifier = Modifier.testTag("main_roomsTab")
                )
                NavigationBarItem(
                    selected = selectedTab == BottomNavTab.Messages,
                    onClick = { selectedTabName = BottomNavTab.Messages.name },
                    icon = {
                        BadgedBox(
                            badge = {
                                if (totalUnreadCount > 0) {
                                    Badge {
                                        Text(
                                            if (totalUnreadCount > 99) "99+"
                                            else "$totalUnreadCount"
                                        )
                                    }
                                }
                            }
                        ) {
                            Icon(Icons.AutoMirrored.Filled.Chat, contentDescription = null)
                        }
                    },
                    label = { Text("Messages") },
                    modifier = Modifier.testTag("main_messagesTab")
                )
                NavigationBarItem(
                    selected = selectedTab == BottomNavTab.Profile,
                    onClick = { selectedTabName = BottomNavTab.Profile.name },
                    icon = { Icon(Icons.Default.Person, contentDescription = null) },
                    label = { Text("Profile") },
                    modifier = Modifier.testTag("main_profileTab")
                )
            }
        },
        floatingActionButton = {
            when (selectedTab) {
                BottomNavTab.Rooms -> {
                    FloatingActionButton(
                        onClick = { showCreateDialog = true },
                        containerColor = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.testTag("main_createRoomFab")
                    ) {
                        Icon(Icons.Default.Add, contentDescription = "Create Room")
                    }
                }
                BottomNavTab.Messages -> {
                    FloatingActionButton(
                        onClick = onNavigateToNewMessage,
                        containerColor = MaterialTheme.colorScheme.primary,
                        modifier = Modifier.testTag("main_newMessageFab")
                    ) {
                        Icon(Icons.Default.Edit, contentDescription = "New Message")
                    }
                }
                else -> {}
            }
        }
    ) { padding ->
        Column(modifier = Modifier.fillMaxSize().padding(padding)) {
            if (isBackendDegraded) {
                DegradedModeBanner()
            }
            Box(modifier = Modifier.weight(1f)) {
                when (selectedTab) {
                    BottomNavTab.Rooms -> {
                        RoomListContent(
                            onNavigateToRoom = onNavigateToRoom,
                            onPrewarmRoom = onPrewarmRoom,
                            onBannerAction = { banner ->
                                val value = banner.actionValue ?: return@RoomListContent
                                when (banner.actionType) {
                                    BannerActionType.URL -> onNavigateToUrl(value)
                                    BannerActionType.ROOM -> onNavigateToRoom(value)
                                    BannerActionType.SCREEN -> when (value) {
                                        "wallet" -> onNavigateToWallet()
                                        "settings" -> onNavigateToSettings()
                                        else -> {}
                                    }
                                    BannerActionType.NONE -> {}
                                }
                            },
                            snackbarHostState = snackbarHostState,
                            showCreateDialog = showCreateDialog,
                            onDismissCreateDialog = { showCreateDialog = false },
                            modifier = Modifier.fillMaxSize()
                        )
                    }
                    BottomNavTab.Messages -> {
                        messagesContent(Modifier.fillMaxSize())
                    }
                    BottomNavTab.Profile -> {
                        profileContent(Modifier.fillMaxSize())
                    }
                }
            }
        }
    }
}
