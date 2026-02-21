package com.shyden.shytalk.feature.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyColumn
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.filled.Close
import androidx.compose.material.icons.filled.People
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.PersonAdd
import androidx.compose.material.icons.automirrored.filled.Undo
import androidx.compose.material3.Badge
import androidx.compose.material3.BadgedBox
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.derivedStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import org.koin.compose.viewmodel.koinViewModel
import org.koin.core.parameter.parametersOf
import androidx.compose.runtime.collectAsState
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.ProfileVisitor
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.ui.StyledDisplayName
import com.shyden.shytalk.core.util.formatRelativeTime

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun FollowListScreen(
    userId: String,
    tab: String = "followers",
    onNavigateBack: () -> Unit,
    onNavigateToUserProfile: (String) -> Unit,
    viewModel: FollowListViewModel = koinViewModel { parametersOf(userId, tab) }
) {
    val uiState by viewModel.uiState.collectAsState()
    val snackbarHostState = remember { SnackbarHostState() }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Connections") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        Column(
            modifier = Modifier
                .fillMaxSize()
                .padding(padding)
        ) {
            val tabCount = if (uiState.isOwnList) 3 else 2
            val selectedIndex = when (uiState.selectedTab) {
                FollowTab.FOLLOWING -> 0
                FollowTab.FOLLOWERS -> 1
                FollowTab.STALKERS -> 2
            }
            PrimaryTabRow(
                selectedTabIndex = selectedIndex.coerceAtMost(tabCount - 1)
            ) {
                Tab(
                    selected = uiState.selectedTab == FollowTab.FOLLOWING,
                    onClick = { viewModel.selectTab(FollowTab.FOLLOWING) },
                    text = { Text("Following (${uiState.following.size})") },
                    modifier = Modifier.testTag("followList_followingTab")
                )
                Tab(
                    selected = uiState.selectedTab == FollowTab.FOLLOWERS,
                    onClick = { viewModel.selectTab(FollowTab.FOLLOWERS) },
                    text = { Text("Followers (${uiState.followers.size})") },
                    modifier = Modifier.testTag("followList_followersTab")
                )
                if (uiState.isOwnList) {
                    Tab(
                        selected = uiState.selectedTab == FollowTab.STALKERS,
                        onClick = { viewModel.selectTab(FollowTab.STALKERS) },
                        text = {
                            val newCount = uiState.stalkers.count {
                                it.lastVisitedAt > uiState.stalkersLastViewedAt
                            }
                            if (newCount > 0 && uiState.selectedTab != FollowTab.STALKERS) {
                                BadgedBox(badge = { Badge { Text("$newCount") } }) {
                                    Text("Stalkers (${uiState.stalkers.size})")
                                }
                            } else {
                                Text("Stalkers (${uiState.stalkers.size})")
                            }
                        }
                    )
                }
            }

            if (uiState.isLoading) {
                Box(
                    modifier = Modifier.fillMaxSize(),
                    contentAlignment = Alignment.Center
                ) {
                    CircularProgressIndicator()
                }
            } else if (uiState.selectedTab == FollowTab.STALKERS) {
                // Stalkers tab content
                if (uiState.stalkers.isEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "No profile visitors yet",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        items(uiState.stalkers, key = { it.visitorId }) { visitor ->
                            val visitorUser = uiState.stalkerUsers[visitor.visitorId]
                            val isNew = visitor.lastVisitedAt > uiState.stalkersLastViewedAt
                            StalkerUserRow(
                                visitor = visitor,
                                user = visitorUser,
                                isNew = isNew,
                                aliases = uiState.aliases,
                                onClick = { onNavigateToUserProfile(visitor.visitorId) }
                            )
                        }
                    }
                }
            } else {
                val users by remember {
                    derivedStateOf {
                        when (uiState.selectedTab) {
                            FollowTab.FOLLOWERS -> uiState.followers
                            FollowTab.FOLLOWING -> uiState.following
                            FollowTab.STALKERS -> emptyList()
                        }
                    }
                }

                if (uiState.followingHidden && uiState.selectedTab == FollowTab.FOLLOWING) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = "This user's following list is private",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else if (users.isEmpty()) {
                    Box(
                        modifier = Modifier.fillMaxSize(),
                        contentAlignment = Alignment.Center
                    ) {
                        Text(
                            text = if (uiState.selectedTab == FollowTab.FOLLOWERS)
                                "No followers yet"
                            else
                                "Not following anyone yet",
                            style = MaterialTheme.typography.bodyLarge,
                            color = MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                } else {
                    LazyColumn(modifier = Modifier.fillMaxSize()) {
                        items(users, key = { it.uid }) { user ->
                            FollowUserRow(
                                user = user,
                                isOwnList = uiState.isOwnList,
                                selectedTab = uiState.selectedTab,
                                iFollowThisUser = user.uid in uiState.currentUserFollowingIds,
                                thisUserFollowsMe = user.uid in uiState.currentUserFollowerIds,
                                isPendingRemove = user.uid == uiState.pendingRemoveFollowerId,
                                onToggleFollow = { viewModel.toggleFollow(user.uid) },
                                onRemoveFollower = { viewModel.removeFollower(user.uid) },
                                onUndoRemove = { viewModel.undoRemoveFollower() },
                                aliases = uiState.aliases,
                                onClick = { onNavigateToUserProfile(user.uid) }
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun FollowUserRow(
    user: User,
    isOwnList: Boolean,
    selectedTab: FollowTab,
    iFollowThisUser: Boolean,
    thisUserFollowsMe: Boolean,
    isPendingRemove: Boolean = false,
    onToggleFollow: () -> Unit,
    onRemoveFollower: () -> Unit = {},
    onUndoRemove: () -> Unit = {},
    aliases: Map<String, String> = emptyMap(),
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Avatar
        val photoUrl = user.photoUrl
        if (photoUrl != null) {
            AsyncImage(
                model = photoUrl,
                contentDescription = user.displayName,
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape),
                contentScale = ContentScale.Crop
            )
        } else {
            Surface(
                modifier = Modifier.size(48.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer
            ) {
                Icon(
                    Icons.Default.Person,
                    contentDescription = null,
                    modifier = Modifier.padding(12.dp),
                    tint = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
        }

        // Name
        Column(modifier = Modifier.weight(1f)) {
            val resolvedName = aliases[user.uid] ?: user.displayName.ifEmpty { "Unknown" }
            StyledDisplayName(
                displayName = resolvedName,
                isSuperShy = user.isSuperShy,
                style = MaterialTheme.typography.bodyLarge
            )
        }

        // Action buttons (only on own lists)
        if (isOwnList) {
            when (selectedTab) {
                FollowTab.FOLLOWING -> {
                    IconButton(onClick = onToggleFollow) {
                        val icon = when {
                            !iFollowThisUser -> Icons.Default.PersonAdd
                            thisUserFollowsMe -> Icons.Default.People
                            else -> Icons.Default.Person
                        }
                        Icon(
                            imageVector = icon,
                            contentDescription = if (iFollowThisUser) "Unfollow" else "Follow",
                            tint = if (iFollowThisUser) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                }
                FollowTab.FOLLOWERS -> {
                    // Follow back button
                    IconButton(onClick = onToggleFollow) {
                        Icon(
                            imageVector = if (iFollowThisUser) Icons.Default.People
                                else Icons.Default.PersonAdd,
                            contentDescription = if (iFollowThisUser) "Unfollow" else "Follow back",
                            tint = if (iFollowThisUser) MaterialTheme.colorScheme.primary
                                else MaterialTheme.colorScheme.onSurfaceVariant
                        )
                    }
                    // Remove follower / Undo button
                    if (isPendingRemove) {
                        IconButton(onClick = onUndoRemove) {
                            Icon(
                                imageVector = Icons.AutoMirrored.Filled.Undo,
                                contentDescription = "Undo remove",
                                tint = MaterialTheme.colorScheme.primary
                            )
                        }
                    } else {
                        IconButton(onClick = onRemoveFollower) {
                            Icon(
                                imageVector = Icons.Default.Close,
                                contentDescription = "Remove follower",
                                tint = MaterialTheme.colorScheme.error
                            )
                        }
                    }
                }
                FollowTab.STALKERS -> {}
            }
        }
    }
}

@Composable
private fun StalkerUserRow(
    visitor: ProfileVisitor,
    user: User?,
    isNew: Boolean,
    aliases: Map<String, String> = emptyMap(),
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        // Avatar
        val photoUrl = user?.photoUrl
        if (photoUrl != null) {
            AsyncImage(
                model = photoUrl,
                contentDescription = user.displayName,
                modifier = Modifier
                    .size(48.dp)
                    .clip(CircleShape),
                contentScale = ContentScale.Crop
            )
        } else {
            Surface(
                modifier = Modifier.size(48.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer
            ) {
                Icon(
                    Icons.Default.Person,
                    contentDescription = null,
                    modifier = Modifier.padding(12.dp),
                    tint = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
        }

        // Name and visit count
        Column(modifier = Modifier.weight(1f)) {
            val resolvedName = aliases[visitor.visitorId]
                ?: user?.displayName?.ifEmpty { "Unknown" }
                ?: "Unknown"
            StyledDisplayName(
                displayName = resolvedName,
                isSuperShy = user?.isSuperShy == true,
                style = MaterialTheme.typography.bodyLarge
            )
            val agoText = remember(visitor.lastVisitedAt) {
                formatRelativeTime(visitor.lastVisitedAt)
            }
            Text(
                text = "Stalked you $agoText, ${visitor.visitCount} time${if (visitor.visitCount != 1L) "s" else ""} in the last 3 months",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }

        // New indicator dot
        if (isNew) {
            Box(
                modifier = Modifier
                    .size(10.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.error)
            )
        }
    }
}
