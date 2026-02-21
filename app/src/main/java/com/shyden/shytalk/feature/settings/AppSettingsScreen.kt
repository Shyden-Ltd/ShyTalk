package com.shyden.shytalk.feature.settings

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.BackHandler
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material.icons.automirrored.filled.KeyboardArrowRight
import androidx.compose.material.icons.automirrored.filled.Logout
import androidx.compose.material.icons.filled.Block
import androidx.compose.material.icons.filled.Delete
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Lock
import androidx.compose.material.icons.filled.Notifications
import androidx.compose.material.icons.filled.Person
import androidx.compose.material.icons.filled.Security
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHost
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Slider
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.key
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.core.content.ContextCompat
import androidx.core.graphics.drawable.toBitmap
import org.koin.compose.viewmodel.koinViewModel
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.shyden.shytalk.BuildConfig
import com.shyden.shytalk.R
import com.shyden.shytalk.core.model.PmPrivacy
import com.shyden.shytalk.core.model.User

private enum class SettingsPage { Main, BlockedUsers, Account, Privacy, Notifications, Permissions, About }

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppSettingsScreen(
    onNavigateBack: () -> Unit,
    onNavigateToPrivacyPolicy: () -> Unit,
    onNavigateToCommunityStandards: () -> Unit = {},
    onNavigateToTermsAndConditions: () -> Unit = {},
    onSignOut: () -> Unit,
    viewModel: AppSettingsViewModel = koinViewModel()
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var currentPageName by rememberSaveable { mutableStateOf(SettingsPage.Main.name) }
    val currentPage = SettingsPage.valueOf(currentPageName)
    var showSignOutDialog by remember { mutableStateOf(false) }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it)
            viewModel.clearError()
        }
    }

    LaunchedEffect(uiState.cacheCleared) {
        if (uiState.cacheCleared) {
            snackbarHostState.showSnackbar("Cache cleared")
            viewModel.resetCacheCleared()
        }
    }

    BackHandler(enabled = currentPage != SettingsPage.Main) {
        currentPageName = SettingsPage.Main.name
    }

    if (uiState.isLoading) {
        SettingsSubPage(
            title = "Settings",
            onBack = onNavigateBack,
            snackbarHostState = snackbarHostState
        ) { modifier ->
            Box(modifier = modifier, contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
    } else {
        when (currentPage) {
            SettingsPage.Main -> SettingsMainPage(
                onNavigateBack = onNavigateBack,
                onNavigateToPage = { currentPageName = it.name },
                onSignOut = { showSignOutDialog = true },
                snackbarHostState = snackbarHostState
            )
            SettingsPage.BlockedUsers -> BlockedUsersPage(
                uiState = uiState,
                onBack = { currentPageName = SettingsPage.Main.name },
                onUnblockUser = { viewModel.unblockUser(it) },
                snackbarHostState = snackbarHostState
            )
            SettingsPage.Account -> AccountPage(
                uiState = uiState,
                onBack = { currentPageName = SettingsPage.Main.name },
                snackbarHostState = snackbarHostState
            )
            SettingsPage.Privacy -> PrivacyPage(
                uiState = uiState,
                onBack = { currentPageName = SettingsPage.Main.name },
                onToggleHideFollowing = { viewModel.toggleHideFollowing() },
                onToggleHideOnlineStatus = { viewModel.toggleHideOnlineStatus() },
                onToggleHideAge = { viewModel.toggleHideAge() },
                onSetPmPrivacy = { viewModel.setPmPrivacy(it) },
                snackbarHostState = snackbarHostState
            )
            SettingsPage.Notifications -> NotificationsPage(
                uiState = uiState,
                onBack = { currentPageName = SettingsPage.Main.name },
                onTogglePmNotifications = { viewModel.togglePmNotifications() },
                onTogglePmSound = { viewModel.togglePmSound() },
                onTogglePmPreview = { viewModel.togglePmPreview() },
                onTogglePmTimestamps = { viewModel.togglePmTimestamps() },
                onTogglePmDateSeparators = { viewModel.togglePmDateSeparators() },
                onToggleDnd = { viewModel.toggleDnd() },
                onSetDndStartHour = { viewModel.setDndStartHour(it) },
                onSetDndStartMinute = { viewModel.setDndStartMinute(it) },
                onSetDndEndHour = { viewModel.setDndEndHour(it) },
                onSetDndEndMinute = { viewModel.setDndEndMinute(it) },
                onSetMinGiftAnimationValue = { viewModel.setMinGiftAnimationValue(it) },
                snackbarHostState = snackbarHostState
            )
            SettingsPage.Permissions -> PermissionsPage(
                onBack = { currentPageName = SettingsPage.Main.name },
                snackbarHostState = snackbarHostState
            )
            SettingsPage.About -> AboutPage(
                uiState = uiState,
                onBack = { currentPageName = SettingsPage.Main.name },
                onNavigateToPrivacyPolicy = onNavigateToPrivacyPolicy,
                onNavigateToCommunityStandards = onNavigateToCommunityStandards,
                onNavigateToTermsAndConditions = onNavigateToTermsAndConditions,
                onCheckForUpdates = { viewModel.checkForUpdates() },
                onClearCache = { viewModel.clearCache() },
                snackbarHostState = snackbarHostState
            )
        }
    }

    // Sign Out confirmation dialog
    if (showSignOutDialog) {
        AlertDialog(
            onDismissRequest = { showSignOutDialog = false },
            title = { Text("Sign Out") },
            text = { Text("Are you sure you want to sign out?") },
            confirmButton = {
                TextButton(onClick = {
                    showSignOutDialog = false
                    onSignOut()
                }) {
                    Text("Sign Out", color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(onClick = { showSignOutDialog = false }) {
                    Text("Cancel")
                }
            }
        )
    }

    // Update check result dialog
    uiState.updateCheckResult?.let { result ->
        val context = LocalContext.current
        AlertDialog(
            onDismissRequest = { viewModel.dismissUpdateResult() },
            title = {
                Text(
                    when (result) {
                        is UpdateCheckResult.UpToDate -> "Up to Date"
                        is UpdateCheckResult.UpdateAvailable -> "Update Available"
                        is UpdateCheckResult.Error -> "Error"
                    }
                )
            },
            text = {
                Text(
                    when (result) {
                        is UpdateCheckResult.UpToDate -> "You're on the latest version."
                        is UpdateCheckResult.UpdateAvailable -> "Version ${result.versionName} is available."
                        is UpdateCheckResult.Error -> result.message
                    }
                )
            },
            confirmButton = {
                if (result is UpdateCheckResult.UpdateAvailable) {
                    Button(onClick = {
                        viewModel.dismissUpdateResult()
                        val intent = Intent(
                            Intent.ACTION_VIEW,
                            Uri.parse("https://play.google.com/store/apps/details?id=com.shyden.shytalk")
                        )
                        context.startActivity(intent)
                    }) {
                        Text("Download Now")
                    }
                } else {
                    TextButton(onClick = { viewModel.dismissUpdateResult() }) {
                        Text("OK")
                    }
                }
            },
            dismissButton = {
                if (result is UpdateCheckResult.UpdateAvailable) {
                    TextButton(onClick = { viewModel.dismissUpdateResult() }) {
                        Text("Later")
                    }
                }
            }
        )
    }
}

// ===== Main Settings Menu =====

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsMainPage(
    onNavigateBack: () -> Unit,
    onNavigateToPage: (SettingsPage) -> Unit,
    onSignOut: () -> Unit,
    snackbarHostState: SnackbarHostState
) {
    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text("Settings") },
                navigationIcon = {
                    IconButton(
                        onClick = onNavigateBack,
                        modifier = Modifier.testTag("settings_backButton")
                    ) {
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
            SettingsMenuItem(
                icon = Icons.Default.Block,
                title = "Blocked Users",
                onClick = { onNavigateToPage(SettingsPage.BlockedUsers) }
            )
            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
            SettingsMenuItem(
                icon = Icons.Default.Person,
                title = "Account",
                onClick = { onNavigateToPage(SettingsPage.Account) }
            )
            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
            SettingsMenuItem(
                icon = Icons.Default.Lock,
                title = "Privacy",
                onClick = { onNavigateToPage(SettingsPage.Privacy) }
            )
            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
            SettingsMenuItem(
                icon = Icons.Default.Notifications,
                title = "Notifications",
                onClick = { onNavigateToPage(SettingsPage.Notifications) }
            )
            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
            SettingsMenuItem(
                icon = Icons.Default.Security,
                title = "Permissions",
                onClick = { onNavigateToPage(SettingsPage.Permissions) }
            )
            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
            SettingsMenuItem(
                icon = Icons.Default.Info,
                title = "About",
                onClick = { onNavigateToPage(SettingsPage.About) }
            )

            Spacer(modifier = Modifier.weight(1f))

            OutlinedButton(
                onClick = onSignOut,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(horizontal = 16.dp)
                    .testTag("settings_signOutButton"),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = MaterialTheme.colorScheme.error
                )
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Logout,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text("Sign Out")
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }
}

@Composable
private fun SettingsMenuItem(
    icon: ImageVector,
    title: String,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(horizontal = 16.dp, vertical = 16.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp)
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = title,
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f)
        )
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
}

// ===== Shared Sub-Page Layout =====

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsSubPage(
    title: String,
    onBack: () -> Unit,
    snackbarHostState: SnackbarHostState,
    content: @Composable (Modifier) -> Unit
) {
    Scaffold(
        snackbarHost = { SnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(onClick = onBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        }
    ) { padding ->
        content(Modifier.fillMaxSize().padding(padding))
    }
}

// ===== Blocked Users Page =====

@Composable
private fun BlockedUsersPage(
    uiState: AppSettingsUiState,
    onBack: () -> Unit,
    onUnblockUser: (String) -> Unit,
    snackbarHostState: SnackbarHostState
) {
    var showUnblockDialog by remember { mutableStateOf<User?>(null) }

    SettingsSubPage(
        title = "Blocked Users",
        onBack = onBack,
        snackbarHostState = snackbarHostState
    ) { modifier ->
        Column(
            modifier = modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
        ) {
            if (uiState.blockedUsers.isEmpty()) {
                Box(
                    modifier = Modifier
                        .fillMaxWidth()
                        .padding(top = 64.dp),
                    contentAlignment = Alignment.TopCenter
                ) {
                    Text(
                        text = "No blocked users",
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            } else {
                Spacer(modifier = Modifier.height(8.dp))
                uiState.blockedUsers.forEach { user ->
                    key(user.uid) {
                        BlockedUserRow(
                            user = user,
                            onUnblock = { showUnblockDialog = user }
                        )
                    }
                }
            }
        }
    }

    showUnblockDialog?.let { user ->
        AlertDialog(
            onDismissRequest = { showUnblockDialog = null },
            title = { Text("Unblock ${user.displayName}?") },
            text = { Text("They will be able to view your profile again.") },
            confirmButton = {
                TextButton(onClick = {
                    onUnblockUser(user.uid)
                    showUnblockDialog = null
                }) {
                    Text("Unblock")
                }
            },
            dismissButton = {
                TextButton(onClick = { showUnblockDialog = null }) {
                    Text("Cancel")
                }
            }
        )
    }
}

// ===== Account Page =====

@Composable
private fun AccountPage(
    uiState: AppSettingsUiState,
    onBack: () -> Unit,
    snackbarHostState: SnackbarHostState
) {
    var showDeleteAccountDialog by remember { mutableStateOf(false) }

    SettingsSubPage(
        title = "Account",
        onBack = onBack,
        snackbarHostState = snackbarHostState
    ) { modifier ->
        Column(
            modifier = modifier
                .padding(horizontal = 16.dp)
        ) {
            Spacer(modifier = Modifier.height(8.dp))
            uiState.user?.let { user ->
                if (user.uniqueId != 0L) {
                    SettingsRow("ShyTalk ID", "${user.uniqueId}")
                }
                user.email?.let { email ->
                    SettingsRow("Email", censorEmail(email))
                }
            }

            Spacer(modifier = Modifier.height(24.dp))

            OutlinedButton(
                onClick = { showDeleteAccountDialog = true },
                modifier = Modifier.fillMaxWidth(),
                colors = ButtonDefaults.outlinedButtonColors(
                    contentColor = MaterialTheme.colorScheme.error
                )
            ) {
                Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(18.dp))
                Spacer(modifier = Modifier.width(8.dp))
                Text("Delete Account")
            }
        }
    }

    if (showDeleteAccountDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteAccountDialog = false },
            title = { Text("Delete Account") },
            text = {
                Text("Account deletion is not available yet. Please contact shytalk.help@gmail.com for assistance.")
            },
            confirmButton = {
                TextButton(onClick = { showDeleteAccountDialog = false }) {
                    Text("OK")
                }
            }
        )
    }
}

// ===== Privacy Page =====

@Composable
private fun PrivacyPage(
    uiState: AppSettingsUiState,
    onBack: () -> Unit,
    onToggleHideFollowing: () -> Unit,
    onToggleHideOnlineStatus: () -> Unit,
    onToggleHideAge: () -> Unit,
    onSetPmPrivacy: (PmPrivacy) -> Unit,
    snackbarHostState: SnackbarHostState
) {
    SettingsSubPage(
        title = "Privacy",
        onBack = onBack,
        snackbarHostState = snackbarHostState
    ) { modifier ->
        Column(
            modifier = modifier
                .padding(horizontal = 16.dp)
        ) {
            Spacer(modifier = Modifier.height(8.dp))
            SettingsSwitch(
                title = "Hide Following List",
                description = "Others won't see who you follow. Followers are always visible.",
                checked = uiState.hideFollowing,
                onCheckedChange = { onToggleHideFollowing() }
            )
            Spacer(modifier = Modifier.height(8.dp))
            SettingsSwitch(
                title = "Hide Online Status",
                description = "Others won't see when you're online.",
                checked = uiState.hideOnlineStatus,
                onCheckedChange = { onToggleHideOnlineStatus() }
            )
            Spacer(modifier = Modifier.height(8.dp))
            SettingsSwitch(
                title = "Hide Age",
                description = "Others won't see your age on your profile.",
                checked = uiState.hideAge,
                onCheckedChange = { onToggleHideAge() }
            )

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            // PM Privacy
            Text(
                text = "Who can message me",
                style = MaterialTheme.typography.bodyLarge
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Control who can send you private messages.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(8.dp))
            PmPrivacy.entries.forEach { privacy ->
                val label = when (privacy) {
                    PmPrivacy.EVERYONE -> "Everyone"
                    PmPrivacy.FOLLOWERS_ONLY -> "People I follow"
                    PmPrivacy.NO_ONE -> "No one"
                }
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { onSetPmPrivacy(privacy) }
                        .padding(vertical = 8.dp),
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    androidx.compose.material3.RadioButton(
                        selected = uiState.pmPrivacy == privacy,
                        onClick = { onSetPmPrivacy(privacy) }
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = label,
                        style = MaterialTheme.typography.bodyMedium
                    )
                }
            }
        }
    }
}

// ===== Notifications Page =====

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun NotificationsPage(
    uiState: AppSettingsUiState,
    onBack: () -> Unit,
    onTogglePmNotifications: () -> Unit,
    onTogglePmSound: () -> Unit,
    onTogglePmPreview: () -> Unit,
    onTogglePmTimestamps: () -> Unit,
    onTogglePmDateSeparators: () -> Unit,
    onToggleDnd: () -> Unit,
    onSetDndStartHour: (Int) -> Unit,
    onSetDndStartMinute: (Int) -> Unit,
    onSetDndEndHour: (Int) -> Unit,
    onSetDndEndMinute: (Int) -> Unit,
    onSetMinGiftAnimationValue: (Int) -> Unit,
    snackbarHostState: SnackbarHostState
) {
    SettingsSubPage(
        title = "Notifications",
        onBack = onBack,
        snackbarHostState = snackbarHostState
    ) { modifier ->
        Column(
            modifier = modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
        ) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = "Private Messages",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(4.dp))
            SettingsSwitch(
                title = "PM Notifications",
                description = "Receive notifications for new private messages.",
                checked = uiState.pmNotificationsEnabled,
                onCheckedChange = { onTogglePmNotifications() }
            )
            Spacer(modifier = Modifier.height(4.dp))
            SettingsSwitch(
                title = "Notification Sound",
                description = "Play a sound when a new message arrives.",
                checked = uiState.pmSoundEnabled,
                onCheckedChange = { onTogglePmSound() }
            )
            Spacer(modifier = Modifier.height(4.dp))
            SettingsSwitch(
                title = "Message Preview",
                description = "Show message text in notifications.",
                checked = uiState.pmNotificationPreview,
                onCheckedChange = { onTogglePmPreview() }
            )

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "Chat Display",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(4.dp))
            SettingsSwitch(
                title = "Show Timestamps",
                description = "Display message timestamps in chat.",
                checked = uiState.pmShowTimestamps,
                onCheckedChange = { onTogglePmTimestamps() }
            )
            Spacer(modifier = Modifier.height(4.dp))
            SettingsSwitch(
                title = "Show Date Separators",
                description = "Show date labels between messages on different days.",
                checked = uiState.pmShowDateSeparators,
                onCheckedChange = { onTogglePmDateSeparators() }
            )

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "Do Not Disturb",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(4.dp))
            SettingsSwitch(
                title = "Enable Do Not Disturb",
                description = "Silence all PM notifications during the scheduled time.",
                checked = uiState.dndEnabled,
                onCheckedChange = { onToggleDnd() }
            )
            if (uiState.dndEnabled) {
                var showStartTimePicker by remember { mutableStateOf(false) }
                var showEndTimePicker by remember { mutableStateOf(false) }

                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { showStartTimePicker = true },
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "Start",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Text(
                        text = String.format("%02d:%02d", uiState.dndStartHour, uiState.dndStartMinute),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Row(
                    modifier = Modifier
                        .fillMaxWidth()
                        .clickable { showEndTimePicker = true },
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically
                ) {
                    Text(
                        text = "End",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Text(
                        text = String.format("%02d:%02d", uiState.dndEndHour, uiState.dndEndMinute),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.primary
                    )
                }

                if (showStartTimePicker) {
                    val startState = rememberTimePickerState(
                        initialHour = uiState.dndStartHour,
                        initialMinute = uiState.dndStartMinute
                    )
                    AlertDialog(
                        onDismissRequest = { showStartTimePicker = false },
                        title = { Text("DND Start Time") },
                        text = { TimePicker(state = startState) },
                        confirmButton = {
                            TextButton(onClick = {
                                onSetDndStartHour(startState.hour)
                                onSetDndStartMinute(startState.minute)
                                showStartTimePicker = false
                            }) { Text("OK") }
                        },
                        dismissButton = {
                            TextButton(onClick = { showStartTimePicker = false }) { Text("Cancel") }
                        }
                    )
                }

                if (showEndTimePicker) {
                    val endState = rememberTimePickerState(
                        initialHour = uiState.dndEndHour,
                        initialMinute = uiState.dndEndMinute
                    )
                    AlertDialog(
                        onDismissRequest = { showEndTimePicker = false },
                        title = { Text("DND End Time") },
                        text = { TimePicker(state = endState) },
                        confirmButton = {
                            TextButton(onClick = {
                                onSetDndEndHour(endState.hour)
                                onSetDndEndMinute(endState.minute)
                                showEndTimePicker = false
                            }) { Text("OK") }
                        },
                        dismissButton = {
                            TextButton(onClick = { showEndTimePicker = false }) { Text("Cancel") }
                        }
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = "Gift Animations",
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = if (uiState.minGiftAnimationValue == 0) "Showing all gift animations"
                       else "Only showing gift animations worth ${uiState.minGiftAnimationValue}+ coins",
                style = MaterialTheme.typography.bodyMedium
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = "Filter out animations for cheaper gifts in rooms.",
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(8.dp))
            var sliderValue by remember(uiState.minGiftAnimationValue) {
                mutableStateOf(uiState.minGiftAnimationValue.toFloat())
            }
            Slider(
                value = sliderValue,
                onValueChange = { sliderValue = it },
                onValueChangeFinished = { onSetMinGiftAnimationValue(sliderValue.toInt()) },
                valueRange = 0f..5000f,
                steps = 9
            )

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

// ===== Permissions Page =====

@Composable
private fun PermissionsPage(
    onBack: () -> Unit,
    snackbarHostState: SnackbarHostState
) {
    val context = LocalContext.current
    val notificationManager = remember {
        context.getSystemService(android.app.NotificationManager::class.java)
    }

    // Re-check permission state when returning from system settings
    var refreshKey by remember { mutableStateOf(0) }
    val lifecycleOwner = androidx.lifecycle.compose.LocalLifecycleOwner.current
    androidx.compose.runtime.DisposableEffect(lifecycleOwner) {
        val observer = androidx.lifecycle.LifecycleEventObserver { _, event ->
            if (event == androidx.lifecycle.Lifecycle.Event.ON_RESUME) {
                refreshKey++
            }
        }
        lifecycleOwner.lifecycle.addObserver(observer)
        onDispose { lifecycleOwner.lifecycle.removeObserver(observer) }
    }

    val notificationsEnabled = remember(refreshKey) {
        notificationManager?.areNotificationsEnabled() == true
    }
    val overlayEnabled = remember(refreshKey) {
        Settings.canDrawOverlays(context)
    }
    val microphoneEnabled = remember(refreshKey) {
        ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) ==
            android.content.pm.PackageManager.PERMISSION_GRANTED
    }
    val bluetoothEnabled = remember(refreshKey) {
        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
            ContextCompat.checkSelfPermission(context, Manifest.permission.BLUETOOTH_CONNECT) ==
                android.content.pm.PackageManager.PERMISSION_GRANTED
        } else true
    }

    SettingsSubPage(
        title = "Permissions",
        onBack = onBack,
        snackbarHostState = snackbarHostState
    ) { modifier ->
        Column(
            modifier = modifier.padding(horizontal = 16.dp)
        ) {
            Spacer(modifier = Modifier.height(8.dp))

            PermissionRow(
                title = "Notifications",
                description = "Receive alerts when you're in a live room in the background.",
                enabled = notificationsEnabled,
                onClick = {
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
                        context.startActivity(
                            Intent(Settings.ACTION_APP_NOTIFICATION_SETTINGS).apply {
                                putExtra(Settings.EXTRA_APP_PACKAGE, context.packageName)
                            }
                        )
                    }
                }
            )

            Spacer(modifier = Modifier.height(8.dp))

            PermissionRow(
                title = "Display over other apps",
                description = "Show a floating bubble when you leave a voice room, so you can quickly return.",
                enabled = overlayEnabled,
                onClick = {
                    context.startActivity(
                        Intent(
                            Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                            Uri.parse("package:${context.packageName}")
                        )
                    )
                }
            )

            Spacer(modifier = Modifier.height(8.dp))

            PermissionRow(
                title = "Microphone",
                description = "Required for voice chat in rooms.",
                enabled = microphoneEnabled,
                onClick = {
                    context.startActivity(
                        Intent(
                            Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                            Uri.parse("package:${context.packageName}")
                        )
                    )
                }
            )

            if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.S) {
                Spacer(modifier = Modifier.height(8.dp))

                PermissionRow(
                    title = "Bluetooth",
                    description = "Connect to Bluetooth audio devices during voice chat.",
                    enabled = bluetoothEnabled,
                    onClick = {
                        context.startActivity(
                            Intent(
                                Settings.ACTION_APPLICATION_DETAILS_SETTINGS,
                                Uri.parse("package:${context.packageName}")
                            )
                        )
                    }
                )
            }
        }
    }
}

@Composable
private fun PermissionRow(
    title: String,
    description: String,
    enabled: Boolean,
    onClick: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .clickable(onClick = onClick)
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge
            )
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = if (enabled) "Allowed" else "Denied",
            style = MaterialTheme.typography.labelMedium,
            color = if (enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error
        )
    }
}

// ===== About Page =====

@Composable
private fun AboutPage(
    uiState: AppSettingsUiState,
    onBack: () -> Unit,
    onNavigateToPrivacyPolicy: () -> Unit,
    onNavigateToCommunityStandards: () -> Unit,
    onNavigateToTermsAndConditions: () -> Unit,
    onCheckForUpdates: () -> Unit,
    onClearCache: () -> Unit,
    snackbarHostState: SnackbarHostState
) {
    val context = LocalContext.current

    SettingsSubPage(
        title = "About",
        onBack = onBack,
        snackbarHostState = snackbarHostState
    ) { modifier ->
        Column(
            modifier = modifier
                .verticalScroll(rememberScrollState())
                .padding(horizontal = 16.dp)
        ) {
            // App icon + version
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp)
            ) {
                val appIcon = remember {
                    ContextCompat.getDrawable(context, R.mipmap.ic_launcher)
                        ?.toBitmap(128, 128)
                        ?.asImageBitmap()
                }
                if (appIcon != null) {
                    androidx.compose.foundation.Image(
                        painter = BitmapPainter(appIcon),
                        contentDescription = "ShyTalk",
                        modifier = Modifier
                            .size(48.dp)
                            .clip(CircleShape)
                    )
                }
                Column {
                    Text(
                        text = "ShyTalk",
                        style = MaterialTheme.typography.titleMedium
                    )
                    Text(
                        text = "v${BuildConfig.VERSION_NAME}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            // Contact
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable {
                        val intent = Intent(Intent.ACTION_SENDTO).apply {
                            data = Uri.parse("mailto:shytalk.help@gmail.com")
                        }
                        context.startActivity(intent)
                    }
                    .padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Contact Us",
                    style = MaterialTheme.typography.bodyLarge
                )
                Spacer(modifier = Modifier.weight(1f))
                Text(
                    text = "shytalk.help@gmail.com",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary
                )
            }

            // Privacy Policy
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onNavigateToPrivacyPolicy() }
                    .padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Privacy Policy",
                    style = MaterialTheme.typography.bodyLarge
                )
            }

            // Community Standards
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onNavigateToCommunityStandards() }
                    .padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Community Standards",
                    style = MaterialTheme.typography.bodyLarge
                )
            }

            // Terms & Conditions
            Row(
                modifier = Modifier
                    .fillMaxWidth()
                    .clickable { onNavigateToTermsAndConditions() }
                    .padding(vertical = 12.dp),
                verticalAlignment = Alignment.CenterVertically
            ) {
                Text(
                    text = "Terms & Conditions",
                    style = MaterialTheme.typography.bodyLarge
                )
            }

            // Check for Updates
            Spacer(modifier = Modifier.height(4.dp))
            OutlinedButton(
                onClick = onCheckForUpdates,
                enabled = !uiState.isCheckingUpdate,
                modifier = Modifier.fillMaxWidth()
            ) {
                if (uiState.isCheckingUpdate) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                }
                Text("Check for Updates")
            }

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            // Clear Cache
            OutlinedButton(
                onClick = onClearCache,
                modifier = Modifier.fillMaxWidth()
            ) {
                Text("Clear Cache")
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

// ===== Helper Composables =====

@Composable
private fun SettingsRow(label: String, value: String) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium
        )
    }
}

@Composable
private fun SettingsSwitch(
    title: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge
            )
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        Spacer(modifier = Modifier.width(8.dp))
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange
        )
    }
}

internal fun censorEmail(email: String): String {
    val parts = email.split("@", limit = 2)
    if (parts.size != 2) return email
    val local = parts[0]
    val domain = parts[1]
    val censored = when {
        local.length <= 2 -> "${local.first()}*"
        else -> "${local.take(2)}${"*".repeat((local.length - 3).coerceAtLeast(1))}${local.last()}"
    }
    return "$censored@$domain"
}

@Composable
private fun BlockedUserRow(
    user: User,
    onUnblock: () -> Unit
) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp)
    ) {
        val photoUrl = user.photoUrl
        if (photoUrl != null) {
            AsyncImage(
                model = photoUrl,
                contentDescription = user.displayName,
                modifier = Modifier
                    .size(40.dp)
                    .clip(CircleShape),
                contentScale = ContentScale.Crop
            )
        } else {
            Surface(
                modifier = Modifier.size(40.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer
            ) {
                Icon(
                    Icons.Default.Person,
                    contentDescription = null,
                    modifier = Modifier.padding(10.dp),
                    tint = MaterialTheme.colorScheme.onPrimaryContainer
                )
            }
        }

        Text(
            text = user.displayName.ifEmpty { "Unknown" },
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f)
        )

        TextButton(onClick = onUnblock) {
            Text("Unblock")
        }
    }
}
