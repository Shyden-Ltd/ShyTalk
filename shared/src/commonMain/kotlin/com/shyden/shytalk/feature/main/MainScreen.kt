package com.shyden.shytalk.feature.main

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.MeetingRoom
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Settings
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
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.feature.home.RoomListContent
import com.shyden.shytalk.ui.theme.CnyGold

enum class BottomNavTab(val label: String) {
    Rooms("Rooms"),
    Profile("Profile")
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun MainScreen(
    onNavigateToRoom: (String) -> Unit,
    onNavigateToUserProfile: (String) -> Unit,
    onNavigateToFollowList: (String, String) -> Unit,
    onNavigateToSettings: () -> Unit,
    onNavigateToLunarNewYear: () -> Unit = {},
    profileContent: @Composable (Modifier) -> Unit
) {
    var selectedTabName by rememberSaveable { mutableStateOf(BottomNavTab.Rooms.name) }
    val selectedTab = BottomNavTab.valueOf(selectedTabName)
    var showCreateDialog by remember { mutableStateOf(false) }
    val snackbarHostState = remember { SnackbarHostState() }

    val primaryColor = MaterialTheme.colorScheme.primary
    val topBarGradient = remember(primaryColor) {
        Brush.horizontalGradient(listOf(primaryColor, CnyGold, primaryColor))
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            Column {
                TopAppBar(
                    title = {
                        Text(
                            when (selectedTab) {
                                BottomNavTab.Rooms -> "\uD83D\uDC0E\uD83C\uDFEE"
                                BottomNavTab.Profile -> "Profile"
                            }
                        )
                    },
                    actions = {
                        if (selectedTab == BottomNavTab.Profile) {
                            IconButton(onClick = onNavigateToSettings) {
                                Icon(Icons.Default.Settings, contentDescription = "Settings")
                            }
                        }
                    }
                )
                // Red-gold gradient decoration strip
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(2.dp)
                        .background(topBarGradient)
                )
            }
        },
        bottomBar = {
            NavigationBar {
                NavigationBarItem(
                    selected = selectedTab == BottomNavTab.Rooms,
                    onClick = { selectedTabName = BottomNavTab.Rooms.name },
                    icon = { Icon(Icons.Default.MeetingRoom, contentDescription = null) },
                    label = { Text("Rooms") }
                )
                NavigationBarItem(
                    selected = selectedTab == BottomNavTab.Profile,
                    onClick = { selectedTabName = BottomNavTab.Profile.name },
                    icon = { Icon(Icons.Default.Person, contentDescription = null) },
                    label = { Text("Profile") }
                )
            }
        },
        floatingActionButton = {
            if (selectedTab == BottomNavTab.Rooms) {
                FloatingActionButton(
                    onClick = { showCreateDialog = true },
                    containerColor = MaterialTheme.colorScheme.primary
                ) {
                    Icon(Icons.Default.Add, contentDescription = "Create Room")
                }
            }
        }
    ) { padding ->
        when (selectedTab) {
            BottomNavTab.Rooms -> {
                RoomListContent(
                    onNavigateToRoom = onNavigateToRoom,
                    onNavigateToLunarNewYear = onNavigateToLunarNewYear,
                    snackbarHostState = snackbarHostState,
                    showCreateDialog = showCreateDialog,
                    onDismissCreateDialog = { showCreateDialog = false },
                    modifier = Modifier
                        .fillMaxSize()
                        .padding(padding)
                )
            }
            BottomNavTab.Profile -> {
                profileContent(
                    Modifier
                        .fillMaxSize()
                        .padding(padding)
                )
            }
        }
    }
}
