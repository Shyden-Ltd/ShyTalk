package com.shyden.shytalk.feature.settings

import androidx.compose.foundation.Image
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
import androidx.compose.material.icons.filled.Language
import androidx.compose.material.icons.filled.Link
import androidx.compose.material.icons.filled.LinkOff
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
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.RadioButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.SnackbarHostState
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TimePicker
import androidx.compose.material3.TopAppBar
import androidx.compose.material3.rememberTimePickerState
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.key
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.graphics.vector.ImageVector
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.effects.PlatformBackHandler
import com.shyden.shytalk.core.model.LinkedProvider
import com.shyden.shytalk.core.model.PmPrivacy
import com.shyden.shytalk.core.model.ProviderType
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.platform.PlatformSettingsService
import com.shyden.shytalk.core.platform.SettingsType
import com.shyden.shytalk.core.ui.StyledSnackbarHost
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject
import org.koin.compose.viewmodel.koinViewModel

private enum class SettingsPage {
    Main,
    BlockedUsers,
    Account,
    LinkedAccounts,
    Privacy,
    Notifications,
    Permissions,
    About,
}

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AppSettingsScreen(
    onNavigateBack: () -> Unit,
    onNavigateToPrivacyPolicy: () -> Unit,
    onNavigateToCommunityStandards: () -> Unit = {},
    onNavigateToTermsAndConditions: () -> Unit = {},
    onNavigateToCyberBullyingPolicy: () -> Unit = {},
    onSignOut: () -> Unit,
    viewModel: AppSettingsViewModel = koinViewModel(),
    platformSettings: PlatformSettingsService = koinInject(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()
    val snackbarHostState = remember { SnackbarHostState() }
    var currentPageName by rememberSaveable { mutableStateOf(SettingsPage.Main.name) }
    val currentPage = SettingsPage.valueOf(currentPageName)
    var showSignOutDialog by remember { mutableStateOf(false) }

    LaunchedEffect(uiState.error) {
        uiState.error?.let {
            snackbarHostState.showSnackbar(it.resolveAsync())
            viewModel.clearError()
        }
    }

    PlatformBackHandler(enabled = currentPage != SettingsPage.Main) {
        currentPageName = SettingsPage.Main.name
    }

    if (uiState.isLoading) {
        SettingsSubPage(
            title = stringResource(Res.string.settings),
            onBack = onNavigateBack,
            snackbarHostState = snackbarHostState,
        ) { modifier ->
            Box(modifier = modifier, contentAlignment = Alignment.Center) {
                CircularProgressIndicator()
            }
        }
    } else {
        when (currentPage) {
            SettingsPage.Main ->
                SettingsMainPage(
                    uiState = uiState,
                    onNavigateBack = onNavigateBack,
                    onNavigateToPage = { currentPageName = it.name },
                    onSetLanguage = {
                        viewModel.setLanguage(it)
                        platformSettings.restartForLanguageChange()
                    },
                    onSignOut = { showSignOutDialog = true },
                    snackbarHostState = snackbarHostState,
                )

            SettingsPage.BlockedUsers ->
                BlockedUsersPage(
                    uiState = uiState,
                    onBack = { currentPageName = SettingsPage.Main.name },
                    onUnblockUser = { viewModel.unblockUser(it) },
                    snackbarHostState = snackbarHostState,
                )

            SettingsPage.Account ->
                AccountPage(
                    uiState = uiState,
                    onBack = { currentPageName = SettingsPage.Main.name },
                    onNavigateToLinkedAccounts = { currentPageName = SettingsPage.LinkedAccounts.name },
                    onRequestDeletion = { pin -> viewModel.requestAccountDeletion(pin) },
                    onCancelDeletion = { viewModel.cancelAccountDeletion() },
                    onRequestExport = { viewModel.requestDataExport() },
                    snackbarHostState = snackbarHostState,
                    platformSettings = platformSettings,
                )

            SettingsPage.LinkedAccounts ->
                LinkedAccountsPage(
                    uiState = uiState,
                    onBack = { currentPageName = SettingsPage.Account.name },
                    onUnlinkProvider = { type, identifier -> viewModel.unlinkProvider(type, identifier) },
                    onLinkProvider = { type -> viewModel.linkProvider(type, "") },
                    snackbarHostState = snackbarHostState,
                )

            SettingsPage.Privacy ->
                PrivacyPage(
                    uiState = uiState,
                    onBack = { currentPageName = SettingsPage.Main.name },
                    onToggleHideFollowing = { viewModel.toggleHideFollowing() },
                    onToggleHideOnlineStatus = { viewModel.toggleHideOnlineStatus() },
                    onToggleHideAge = { viewModel.toggleHideAge() },
                    onSetPmPrivacy = { viewModel.setPmPrivacy(it) },
                    snackbarHostState = snackbarHostState,
                )

            SettingsPage.Notifications ->
                NotificationsPage(
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
                    onToggleSelfDestructAlert = { viewModel.toggleSelfDestructAlert() },
                    snackbarHostState = snackbarHostState,
                )

            SettingsPage.Permissions ->
                PermissionsPage(
                    onBack = { currentPageName = SettingsPage.Main.name },
                    snackbarHostState = snackbarHostState,
                    platformSettings = platformSettings,
                )

            SettingsPage.About ->
                AboutPage(
                    uiState = uiState,
                    onBack = { currentPageName = SettingsPage.Main.name },
                    onNavigateToPrivacyPolicy = onNavigateToPrivacyPolicy,
                    onNavigateToCommunityStandards = onNavigateToCommunityStandards,
                    onNavigateToTermsAndConditions = onNavigateToTermsAndConditions,
                    onNavigateToCyberBullyingPolicy = onNavigateToCyberBullyingPolicy,
                    onCheckForUpdates = { viewModel.checkForUpdates() },
                    onClearCache = { viewModel.requestClearCache() },
                    snackbarHostState = snackbarHostState,
                    platformSettings = platformSettings,
                )
        }
    }

    // Sign Out confirmation dialog
    if (showSignOutDialog) {
        AlertDialog(
            onDismissRequest = { showSignOutDialog = false },
            title = { Text(stringResource(Res.string.sign_out)) },
            text = { Text(stringResource(Res.string.sign_out_confirm)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        showSignOutDialog = false
                        onSignOut()
                    },
                    modifier = Modifier.testTag("settings_signOutConfirmButton"),
                ) {
                    Text(stringResource(Res.string.sign_out), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showSignOutDialog = false },
                    modifier = Modifier.testTag("settings_signOutCancelButton"),
                ) {
                    Text(stringResource(Res.string.cancel))
                }
            },
        )
    }

    // Clear cache confirmation dialog
    if (uiState.showClearCacheDialog) {
        AlertDialog(
            onDismissRequest = { viewModel.dismissClearCacheDialog() },
            title = { Text(stringResource(Res.string.clear_cache)) },
            text = { Text(stringResource(Res.string.clear_cache_confirm, formatCacheSize(uiState.cacheSizeBytes))) },
            confirmButton = {
                TextButton(
                    onClick = { viewModel.clearCache() },
                    modifier = Modifier.testTag("settings_clearCacheConfirmButton"),
                ) {
                    Text(stringResource(Res.string.clear))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { viewModel.dismissClearCacheDialog() },
                    modifier = Modifier.testTag("settings_clearCacheCancelButton"),
                ) {
                    Text(stringResource(Res.string.cancel))
                }
            },
        )
    }

    // Cache cleared success dialog
    if (uiState.cacheCleared) {
        AlertDialog(
            onDismissRequest = { viewModel.resetCacheCleared() },
            title = { Text(stringResource(Res.string.cache_cleared)) },
            text = { Text(stringResource(Res.string.cache_cleared_description)) },
            confirmButton = {
                TextButton(
                    onClick = { viewModel.resetCacheCleared() },
                    modifier = Modifier.testTag("settings_cacheClearedOkButton"),
                ) {
                    Text(stringResource(Res.string.ok))
                }
            },
        )
    }

    // Update check result dialog
    uiState.updateCheckResult?.let { result ->
        var openStoreFailed by remember(result) { mutableStateOf(false) }
        AlertDialog(
            onDismissRequest = { viewModel.dismissUpdateResult() },
            title = {
                Text(
                    when (result) {
                        is UpdateCheckResult.UpToDate -> stringResource(Res.string.up_to_date)
                        is UpdateCheckResult.UpdateAvailable -> stringResource(Res.string.update_available)
                        is UpdateCheckResult.Error -> stringResource(Res.string.error_title)
                    },
                )
            },
            text = {
                Column {
                    Text(
                        when (result) {
                            is UpdateCheckResult.UpToDate -> stringResource(Res.string.up_to_date_description)

                            is UpdateCheckResult.UpdateAvailable ->
                                stringResource(Res.string.update_available_description, result.versionName)

                            is UpdateCheckResult.Error -> result.message.resolve()
                        },
                    )
                    if (openStoreFailed) {
                        Spacer(modifier = Modifier.height(12.dp))
                        Text(
                            text = stringResource(Res.string.update_open_store_failed),
                            style = MaterialTheme.typography.bodySmall,
                            color = MaterialTheme.colorScheme.error,
                            modifier = Modifier.testTag("settings_updateOpenStoreFailed"),
                        )
                    }
                }
            },
            confirmButton = {
                if (result is UpdateCheckResult.UpdateAvailable) {
                    Button(
                        onClick = {
                            // Dismiss only on success — if the store failed to
                            // open we keep the dialog visible and surface the
                            // failure inline so the user can retry or pick Later.
                            if (platformSettings.openPlayStore("com.shyden.shytalk")) {
                                viewModel.dismissUpdateResult()
                            } else {
                                openStoreFailed = true
                            }
                        },
                        modifier = Modifier.testTag("settings_downloadUpdateButton"),
                    ) {
                        Text(stringResource(Res.string.download_now))
                    }
                } else {
                    TextButton(
                        onClick = { viewModel.dismissUpdateResult() },
                        modifier = Modifier.testTag("settings_updateResultOkButton"),
                    ) {
                        Text(stringResource(Res.string.ok))
                    }
                }
            },
            dismissButton = {
                if (result is UpdateCheckResult.UpdateAvailable) {
                    TextButton(
                        onClick = { viewModel.dismissUpdateResult() },
                        modifier = Modifier.testTag("settings_updateResultLaterButton"),
                    ) {
                        Text(stringResource(Res.string.later))
                    }
                }
            },
        )
    }
}

// ===== Main Settings Menu =====

private val SUPPORTED_LANGUAGES =
    listOf(
        "en" to "English",
        "es" to "Español",
        "ar" to "العربية",
        "ja" to "日本語",
        "ko" to "한국어",
        "zh" to "中文",
        "fr" to "Français",
        "de" to "Deutsch",
        "pt" to "Português",
        "ru" to "Русский",
        "hi" to "हिन्दी",
        "tr" to "Türkçe",
        "it" to "Italiano",
        "th" to "ไทย",
        "vi" to "Tiếng Việt",
        "id" to "Bahasa Indonesia",
        "pl" to "Polski",
        "nl" to "Nederlands",
        "sv" to "Svenska",
        "uk" to "Українська",
    )

@OptIn(ExperimentalMaterial3Api::class)
@Composable
private fun SettingsMainPage(
    uiState: AppSettingsUiState,
    onNavigateBack: () -> Unit,
    onNavigateToPage: (SettingsPage) -> Unit,
    onSetLanguage: (String) -> Unit,
    onSignOut: () -> Unit,
    snackbarHostState: SnackbarHostState,
) {
    var showLanguageDialog by remember { mutableStateOf(false) }
    Scaffold(
        snackbarHost = { StyledSnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(stringResource(Res.string.settings)) },
                navigationIcon = {
                    IconButton(
                        onClick = onNavigateBack,
                        modifier = Modifier.testTag("settings_backButton"),
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back))
                    }
                },
            )
        },
    ) { padding ->
        Column(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(padding),
        ) {
            SettingsMenuItem(
                icon = Icons.Default.Block,
                title = stringResource(Res.string.blocked_users),
                onClick = { onNavigateToPage(SettingsPage.BlockedUsers) },
                testTag = "settings_blockedUsersItem",
            )
            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
            SettingsMenuItem(
                icon = Icons.Default.Person,
                title = stringResource(Res.string.account),
                onClick = { onNavigateToPage(SettingsPage.Account) },
                testTag = "settings_accountItem",
            )
            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
            SettingsMenuItem(
                icon = Icons.Default.Lock,
                title = stringResource(Res.string.privacy),
                onClick = { onNavigateToPage(SettingsPage.Privacy) },
                testTag = "settings_privacyItem",
            )
            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
            SettingsMenuItem(
                icon = Icons.Default.Notifications,
                title = stringResource(Res.string.notifications),
                onClick = { onNavigateToPage(SettingsPage.Notifications) },
                testTag = "settings_notificationsItem",
            )
            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
            SettingsMenuItem(
                icon = Icons.Default.Language,
                title = stringResource(Res.string.language),
                subtitle =
                    SUPPORTED_LANGUAGES.firstOrNull { it.first == uiState.language }?.second
                        ?: stringResource(Res.string.english_language),
                onClick = { showLanguageDialog = true },
                testTag = "settings_languageItem",
            )
            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
            SettingsMenuItem(
                icon = Icons.Default.Security,
                title = stringResource(Res.string.permissions),
                onClick = { onNavigateToPage(SettingsPage.Permissions) },
                testTag = "settings_permissionsItem",
            )
            HorizontalDivider(modifier = Modifier.padding(horizontal = 16.dp))
            SettingsMenuItem(
                icon = Icons.Default.Info,
                title = stringResource(Res.string.about),
                onClick = { onNavigateToPage(SettingsPage.About) },
                testTag = "settings_aboutItem",
            )

            Spacer(modifier = Modifier.weight(1f))

            OutlinedButton(
                onClick = onSignOut,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 16.dp)
                        .testTag("settings_signOutButton"),
                colors =
                    ButtonDefaults.outlinedButtonColors(
                        contentColor = MaterialTheme.colorScheme.error,
                    ),
            ) {
                Icon(
                    Icons.AutoMirrored.Filled.Logout,
                    contentDescription = null,
                    modifier = Modifier.size(18.dp),
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(stringResource(Res.string.sign_out))
            }

            Spacer(modifier = Modifier.height(24.dp))
        }
    }

    if (showLanguageDialog) {
        AlertDialog(
            onDismissRequest = { showLanguageDialog = false },
            title = { Text(stringResource(Res.string.language)) },
            text = {
                Column(
                    modifier = Modifier.verticalScroll(rememberScrollState()),
                ) {
                    SUPPORTED_LANGUAGES.forEach { (code, name) ->
                        Row(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .clickable {
                                        onSetLanguage(code)
                                        showLanguageDialog = false
                                    }.padding(vertical = 10.dp)
                                    .testTag("settings_language_$code"),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            RadioButton(
                                selected = uiState.language == code,
                                onClick = {
                                    onSetLanguage(code)
                                    showLanguageDialog = false
                                },
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = name,
                                style = MaterialTheme.typography.bodyMedium,
                            )
                        }
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = { showLanguageDialog = false },
                    modifier = Modifier.testTag("settings_languageDialogCancelButton"),
                ) {
                    Text(stringResource(Res.string.cancel))
                }
            },
        )
    }
}

@Composable
private fun SettingsMenuItem(
    icon: ImageVector,
    title: String,
    subtitle: String? = null,
    onClick: () -> Unit,
    testTag: String = "",
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(horizontal = 16.dp, vertical = 16.dp)
                .then(if (testTag.isNotEmpty()) Modifier.testTag(testTag) else Modifier),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(
            imageVector = icon,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
            )
            if (subtitle != null) {
                Text(
                    text = subtitle,
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                )
            }
        }
        Icon(
            Icons.AutoMirrored.Filled.KeyboardArrowRight,
            contentDescription = null,
            tint = MaterialTheme.colorScheme.onSurfaceVariant,
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
    content: @Composable (Modifier) -> Unit,
) {
    Scaffold(
        snackbarHost = { StyledSnackbarHost(snackbarHostState) },
        topBar = {
            TopAppBar(
                title = { Text(title) },
                navigationIcon = {
                    IconButton(
                        onClick = onBack,
                        modifier = Modifier.testTag("settings_subPageBackButton"),
                    ) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back))
                    }
                },
            )
        },
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
    snackbarHostState: SnackbarHostState,
) {
    var showUnblockDialog by remember { mutableStateOf<User?>(null) }

    SettingsSubPage(
        title = stringResource(Res.string.blocked_users),
        onBack = onBack,
        snackbarHostState = snackbarHostState,
    ) { modifier ->
        Column(
            modifier =
                modifier
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp),
        ) {
            if (uiState.blockedUsers.isEmpty()) {
                Box(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(top = 64.dp),
                    contentAlignment = Alignment.TopCenter,
                ) {
                    Text(
                        text = stringResource(Res.string.no_blocked_users),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                Spacer(modifier = Modifier.height(8.dp))
                uiState.blockedUsers.forEach { user ->
                    key(user.uid) {
                        BlockedUserRow(
                            user = user,
                            onUnblock = { showUnblockDialog = user },
                        )
                    }
                }
            }
        }
    }

    showUnblockDialog?.let { user ->
        AlertDialog(
            onDismissRequest = { showUnblockDialog = null },
            title = { Text(stringResource(Res.string.unblock_confirm, user.displayName)) },
            text = { Text(stringResource(Res.string.unblock_description)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        onUnblockUser(user.uid)
                        showUnblockDialog = null
                    },
                    modifier = Modifier.testTag("settings_unblockConfirmButton"),
                ) {
                    Text(stringResource(Res.string.unblock))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showUnblockDialog = null },
                    modifier = Modifier.testTag("settings_unblockCancelButton"),
                ) {
                    Text(stringResource(Res.string.cancel))
                }
            },
        )
    }
}

@Composable
private fun BlockedUserRow(
    user: User,
    onUnblock: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = 6.dp)
                .testTag("settings_blockedUserRow_${user.uid}"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        val photoUrl = user.photoUrl
        if (photoUrl != null) {
            AsyncImage(
                model = photoUrl,
                contentDescription = user.displayName,
                modifier =
                    Modifier
                        .size(40.dp)
                        .clip(CircleShape),
                contentScale = ContentScale.Crop,
            )
        } else {
            Surface(
                modifier = Modifier.size(40.dp),
                shape = CircleShape,
                color = MaterialTheme.colorScheme.primaryContainer,
            ) {
                Icon(
                    Icons.Default.Person,
                    contentDescription = null,
                    modifier = Modifier.padding(10.dp),
                    tint = MaterialTheme.colorScheme.onPrimaryContainer,
                )
            }
        }

        Text(
            text = user.displayName.ifEmpty { stringResource(Res.string.unknown) },
            style = MaterialTheme.typography.bodyLarge,
            modifier = Modifier.weight(1f),
        )

        TextButton(
            onClick = onUnblock,
            modifier = Modifier.testTag("settings_unblockButton_${user.uid}"),
        ) {
            Text(stringResource(Res.string.unblock))
        }
    }
}

// ===== Account Page =====

@Composable
private fun AccountPage(
    uiState: AppSettingsUiState,
    onBack: () -> Unit,
    onNavigateToLinkedAccounts: () -> Unit,
    onRequestDeletion: (pin: String) -> Unit,
    onCancelDeletion: () -> Unit,
    onRequestExport: () -> Unit,
    snackbarHostState: SnackbarHostState,
    platformSettings: PlatformSettingsService,
) {
    var showDeleteAccountDialog by remember { mutableStateOf(false) }
    var showPinVerification by remember { mutableStateOf(false) }

    SettingsSubPage(
        title = stringResource(Res.string.account),
        onBack = onBack,
        snackbarHostState = snackbarHostState,
    ) { modifier ->
        Column(
            modifier =
                modifier
                    .padding(horizontal = 16.dp),
        ) {
            Spacer(modifier = Modifier.height(8.dp))
            uiState.user?.let { user ->
                if (user.uniqueId != 0L) {
                    SettingsRow(stringResource(Res.string.shytalk_id), "${user.uniqueId}")
                }
                user.email?.let { email ->
                    SettingsRow(stringResource(Res.string.email), censorEmail(email))
                }
            }
            uiState.currentSignInProvider?.let { provider ->
                SettingsRow(
                    stringResource(Res.string.signed_in_with),
                    provider.replaceFirstChar { it.uppercase() },
                )
            }

            Spacer(modifier = Modifier.height(8.dp))
            HorizontalDivider()
            SettingsMenuItem(
                icon = Icons.Default.Link,
                title = stringResource(Res.string.linked_accounts),
                subtitle =
                    uiState.user?.let {
                        "${it.activeProviders.size} ${stringResource(Res.string.linked).lowercase()}"
                    },
                onClick = onNavigateToLinkedAccounts,
                testTag = "settings_linkedAccountsItem",
            )
            HorizontalDivider()

            Spacer(modifier = Modifier.height(16.dp))

            // Data export
            // Mirror the server 24h rate-limit window (RATE_LIMIT_MS in
            // express-api/src/routes/data-export.js). Disable the button
            // only while the most recent request is within that window —
            // do NOT keep it disabled forever based on a stale local
            // "pending" flag, which previously locked users out of GDPR
            // re-requests until app restart.
            // currentTimeMillis() here is the PROJECT KMP wrapper (see
            // shared/src/commonMain/.../core/util/PlatformTime.kt), NOT
            // System.currentTimeMillis() — see CLAUDE.md.
            val exportRateLimitMs = 24L * 60L * 60L * 1000L
            val exportRecentlyRequested =
                uiState.exportRequestedAtMs?.let { requestedAt ->
                    (currentTimeMillis() - requestedAt) < exportRateLimitMs
                } == true
            OutlinedButton(
                onClick = { onRequestExport() },
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .testTag("settings_exportDataButton"),
                enabled = !uiState.isExportRequesting && !exportRecentlyRequested,
            ) {
                Text(stringResource(Res.string.export_data))
            }
            if (exportRecentlyRequested) {
                Text(
                    text = stringResource(Res.string.export_data_pending),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.primary,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }
            uiState.exportError?.let { error ->
                Text(
                    text = error.resolve(),
                    style = MaterialTheme.typography.bodySmall,
                    color = MaterialTheme.colorScheme.error,
                    modifier = Modifier.padding(top = 4.dp),
                )
            }

            Spacer(modifier = Modifier.height(16.dp))

            if (uiState.deletionScheduled && uiState.deletionDeleteAt != null) {
                val deleteDate = platformSettings.formatDate(uiState.deletionDeleteAt)
                Text(
                    text = stringResource(Res.string.delete_account_scheduled, deleteDate),
                    color = MaterialTheme.colorScheme.error,
                    style = MaterialTheme.typography.bodyMedium,
                    modifier = Modifier.padding(vertical = 8.dp),
                )
                OutlinedButton(
                    onClick = { onCancelDeletion() },
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .testTag("settings_cancelDeletionButton"),
                    colors =
                        ButtonDefaults.outlinedButtonColors(
                            contentColor = MaterialTheme.colorScheme.primary,
                        ),
                ) {
                    Text(stringResource(Res.string.delete_account_cancel))
                }
            } else {
                OutlinedButton(
                    onClick = { showDeleteAccountDialog = true },
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .testTag("settings_deleteAccountButton"),
                    colors =
                        ButtonDefaults.outlinedButtonColors(
                            contentColor = MaterialTheme.colorScheme.error,
                        ),
                ) {
                    Icon(Icons.Default.Delete, contentDescription = null, modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(stringResource(Res.string.delete_account))
                }
            }
        }
    }

    if (showDeleteAccountDialog) {
        AlertDialog(
            onDismissRequest = { showDeleteAccountDialog = false },
            title = { Text(stringResource(Res.string.delete_account_confirm_title)) },
            text = {
                Text(stringResource(Res.string.delete_account_confirm_body))
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        showDeleteAccountDialog = false
                        showPinVerification = true
                    },
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.testTag("settings_deleteAccountConfirmButton"),
                ) {
                    Text(stringResource(Res.string.delete_account))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showDeleteAccountDialog = false },
                    modifier = Modifier.testTag("settings_deleteAccountCancelButton"),
                ) {
                    Text(stringResource(Res.string.cancel))
                }
            },
        )
    }

    if (showPinVerification) {
        var pinInput by remember { mutableStateOf("") }
        AlertDialog(
            onDismissRequest = { showPinVerification = false },
            title = { Text(stringResource(Res.string.delete_account_pin_required)) },
            text = {
                Column {
                    OutlinedTextField(
                        value = pinInput,
                        onValueChange = { if (it.length <= 8) pinInput = it },
                        label = { Text(stringResource(Res.string.pin_verify_subtitle)) },
                        singleLine = true,
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .testTag("settings_deletePinInput"),
                    )
                    uiState.deletionError?.let { error ->
                        Spacer(modifier = Modifier.height(8.dp))
                        Text(
                            text = error.resolve(),
                            color = MaterialTheme.colorScheme.error,
                            style = MaterialTheme.typography.bodySmall,
                        )
                    }
                }
            },
            confirmButton = {
                TextButton(
                    onClick = {
                        onRequestDeletion(pinInput)
                        showPinVerification = false
                    },
                    enabled = pinInput.isNotEmpty() && !uiState.isDeletionRequesting,
                    colors = ButtonDefaults.textButtonColors(contentColor = MaterialTheme.colorScheme.error),
                    modifier = Modifier.testTag("settings_deletePinConfirmButton"),
                ) {
                    Text(stringResource(Res.string.delete_account))
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showPinVerification = false },
                    modifier = Modifier.testTag("settings_deletePinCancelButton"),
                ) {
                    Text(stringResource(Res.string.cancel))
                }
            },
        )
    }
}

// ===== Linked Accounts Page =====

@Composable
private fun LinkedAccountsPage(
    uiState: AppSettingsUiState,
    onBack: () -> Unit,
    onUnlinkProvider: (ProviderType, String) -> Unit,
    onLinkProvider: (ProviderType) -> Unit,
    snackbarHostState: SnackbarHostState,
) {
    var showUnlinkDialog by remember { mutableStateOf<LinkedProvider?>(null) }

    SettingsSubPage(
        title = stringResource(Res.string.linked_accounts),
        onBack = onBack,
        snackbarHostState = snackbarHostState,
    ) { modifier ->
        Column(
            modifier =
                modifier
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp),
        ) {
            val user = uiState.user
            if (user == null || user.providers.isEmpty()) {
                Box(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .padding(top = 64.dp),
                    contentAlignment = Alignment.TopCenter,
                ) {
                    Text(
                        text = stringResource(Res.string.no_linked_accounts),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            } else {
                Spacer(modifier = Modifier.height(8.dp))
                user.providers.forEach { provider ->
                    key(provider.type.key + provider.identifier) {
                        ProviderRow(
                            provider = provider,
                            canUnlink = user.activeProviders.size >= 2 && provider.active,
                            isUnlinking = uiState.isUnlinkingProvider,
                            onUnlink = { showUnlinkDialog = provider },
                        )
                        HorizontalDivider(modifier = Modifier.padding(start = 56.dp))
                    }
                }

                // Show "Connect" buttons for providers not yet linked
                val allProviderTypes = listOf(ProviderType.GOOGLE, ProviderType.APPLE, ProviderType.EMAIL)
                val linkedTypes = user.activeProviders.map { it.type }.toSet()
                val unlinkedTypes = allProviderTypes.filter { it !in linkedTypes }

                if (unlinkedTypes.isNotEmpty()) {
                    Spacer(modifier = Modifier.height(16.dp))
                    HorizontalDivider()
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = stringResource(Res.string.connect_account),
                        style = MaterialTheme.typography.titleSmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                        modifier = Modifier.padding(vertical = 8.dp),
                    )
                    unlinkedTypes.forEach { type ->
                        OutlinedButton(
                            onClick = { onLinkProvider(type) },
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .padding(vertical = 4.dp)
                                    .testTag("settings_connectProvider_${type.key}"),
                        ) {
                            Icon(
                                imageVector =
                                    when (type) {
                                        ProviderType.GOOGLE -> Icons.Default.Person
                                        ProviderType.APPLE -> Icons.Default.Lock
                                        ProviderType.EMAIL -> Icons.Default.Link
                                        else -> Icons.Default.Link
                                    },
                                contentDescription = null,
                                modifier = Modifier.size(20.dp),
                            )
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(stringResource(Res.string.connect) + " " + providerDisplayName(type))
                        }
                    }
                }
            }
        }
    }

    showUnlinkDialog?.let { provider ->
        AlertDialog(
            onDismissRequest = { showUnlinkDialog = null },
            title = { Text(stringResource(Res.string.unlink_provider_confirm, providerDisplayName(provider.type))) },
            text = { Text(stringResource(Res.string.unlink_provider_description)) },
            confirmButton = {
                TextButton(
                    onClick = {
                        onUnlinkProvider(provider.type, provider.identifier)
                        showUnlinkDialog = null
                    },
                    modifier = Modifier.testTag("settings_unlinkProviderConfirmButton"),
                ) {
                    Text(stringResource(Res.string.unlink), color = MaterialTheme.colorScheme.error)
                }
            },
            dismissButton = {
                TextButton(
                    onClick = { showUnlinkDialog = null },
                    modifier = Modifier.testTag("settings_unlinkProviderCancelButton"),
                ) {
                    Text(stringResource(Res.string.cancel))
                }
            },
        )
    }
}

@Composable
private fun ProviderRow(
    provider: LinkedProvider,
    canUnlink: Boolean,
    isUnlinking: Boolean,
    onUnlink: () -> Unit,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = 12.dp)
                .testTag("settings_providerRow_${provider.type.key}"),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.spacedBy(16.dp),
    ) {
        Icon(
            imageVector = if (provider.active) Icons.Default.Link else Icons.Default.LinkOff,
            contentDescription = null,
            tint =
                if (provider.active) {
                    MaterialTheme.colorScheme.primary
                } else {
                    MaterialTheme.colorScheme.onSurfaceVariant
                },
            modifier = Modifier.size(24.dp),
        )
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = providerDisplayName(provider.type),
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                text =
                    if (provider.type == ProviderType.APPLE) {
                        "Connected"
                    } else {
                        censorEmail(provider.identifier)
                    },
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            if (!provider.active) {
                Text(
                    text = stringResource(Res.string.unlinked),
                    style = MaterialTheme.typography.labelSmall,
                    color = MaterialTheme.colorScheme.error,
                )
            }
        }
        if (canUnlink) {
            if (isUnlinking) {
                CircularProgressIndicator(modifier = Modifier.size(20.dp), strokeWidth = 2.dp)
            } else {
                TextButton(
                    onClick = onUnlink,
                    modifier = Modifier.testTag("settings_unlinkButton_${provider.type.key}"),
                ) {
                    Text(
                        text = stringResource(Res.string.unlink),
                        color = MaterialTheme.colorScheme.error,
                    )
                }
            }
        }
    }
}

@Composable
private fun providerDisplayName(type: ProviderType): String =
    when (type) {
        ProviderType.GOOGLE -> stringResource(Res.string.provider_google)
        ProviderType.APPLE -> stringResource(Res.string.provider_apple)
        ProviderType.EMAIL -> stringResource(Res.string.provider_email)
        ProviderType.UNKNOWN -> type.key
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
    snackbarHostState: SnackbarHostState,
) {
    SettingsSubPage(
        title = stringResource(Res.string.privacy),
        onBack = onBack,
        snackbarHostState = snackbarHostState,
    ) { modifier ->
        Column(
            modifier =
                modifier
                    .padding(horizontal = 16.dp),
        ) {
            Spacer(modifier = Modifier.height(8.dp))
            SettingsSwitch(
                title = stringResource(Res.string.hide_following_list),
                description = stringResource(Res.string.hide_following_description),
                checked = uiState.hideFollowing,
                onCheckedChange = { onToggleHideFollowing() },
                testTag = "settings_hideFollowingSwitch",
            )
            Spacer(modifier = Modifier.height(8.dp))
            SettingsSwitch(
                title = stringResource(Res.string.hide_online_status),
                description = stringResource(Res.string.hide_online_status_description),
                checked = uiState.hideOnlineStatus,
                onCheckedChange = { onToggleHideOnlineStatus() },
                testTag = "settings_hideOnlineStatusSwitch",
            )
            Spacer(modifier = Modifier.height(8.dp))
            SettingsSwitch(
                title = stringResource(Res.string.hide_age),
                description = stringResource(Res.string.hide_age_description),
                checked = uiState.hideAge,
                onCheckedChange = { onToggleHideAge() },
                testTag = "settings_hideAgeSwitch",
            )

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            // PM Privacy
            Text(
                text = stringResource(Res.string.who_can_message_me),
                style = MaterialTheme.typography.bodyLarge,
            )
            Spacer(modifier = Modifier.height(4.dp))
            Text(
                text = stringResource(Res.string.who_can_message_description),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
            Spacer(modifier = Modifier.height(8.dp))
            PmPrivacy.entries.forEach { privacy ->
                val label =
                    when (privacy) {
                        PmPrivacy.EVERYONE -> stringResource(Res.string.everyone)
                        PmPrivacy.FOLLOWERS_ONLY -> stringResource(Res.string.people_i_follow)
                        PmPrivacy.NO_ONE -> stringResource(Res.string.no_one)
                    }
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clickable { onSetPmPrivacy(privacy) }
                            .padding(vertical = 8.dp)
                            .testTag("settings_pmPrivacy_${privacy.name}"),
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    RadioButton(
                        selected = uiState.pmPrivacy == privacy,
                        onClick = { onSetPmPrivacy(privacy) },
                    )
                    Spacer(modifier = Modifier.width(8.dp))
                    Text(
                        text = label,
                        style = MaterialTheme.typography.bodyMedium,
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
    onToggleSelfDestructAlert: () -> Unit,
    snackbarHostState: SnackbarHostState,
) {
    SettingsSubPage(
        title = stringResource(Res.string.notifications),
        onBack = onBack,
        snackbarHostState = snackbarHostState,
    ) { modifier ->
        Column(
            modifier =
                modifier
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp),
        ) {
            Spacer(modifier = Modifier.height(8.dp))
            Text(
                text = stringResource(Res.string.private_messages),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(modifier = Modifier.height(4.dp))
            SettingsSwitch(
                title = stringResource(Res.string.pm_notifications),
                description = stringResource(Res.string.pm_notifications_description),
                checked = uiState.pmNotificationsEnabled,
                onCheckedChange = { onTogglePmNotifications() },
                testTag = "settings_pmNotificationsSwitch",
            )
            Spacer(modifier = Modifier.height(4.dp))
            SettingsSwitch(
                title = stringResource(Res.string.notification_sound),
                description = stringResource(Res.string.notification_sound_description),
                checked = uiState.pmSoundEnabled,
                onCheckedChange = { onTogglePmSound() },
                testTag = "settings_pmSoundSwitch",
            )
            Spacer(modifier = Modifier.height(4.dp))
            SettingsSwitch(
                title = stringResource(Res.string.message_preview),
                description = stringResource(Res.string.message_preview_description),
                checked = uiState.pmNotificationPreview,
                onCheckedChange = { onTogglePmPreview() },
                testTag = "settings_pmPreviewSwitch",
            )

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = stringResource(Res.string.chat_display),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(modifier = Modifier.height(4.dp))
            SettingsSwitch(
                title = stringResource(Res.string.show_timestamps),
                description = stringResource(Res.string.show_timestamps_description),
                checked = uiState.pmShowTimestamps,
                onCheckedChange = { onTogglePmTimestamps() },
                testTag = "settings_pmTimestampsSwitch",
            )
            Spacer(modifier = Modifier.height(4.dp))
            SettingsSwitch(
                title = stringResource(Res.string.show_date_separators),
                description = stringResource(Res.string.show_date_separators_description),
                checked = uiState.pmShowDateSeparators,
                onCheckedChange = { onTogglePmDateSeparators() },
                testTag = "settings_pmDateSeparatorsSwitch",
            )

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = stringResource(Res.string.do_not_disturb),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(modifier = Modifier.height(4.dp))
            SettingsSwitch(
                title = stringResource(Res.string.enable_dnd),
                description = stringResource(Res.string.enable_dnd_description),
                checked = uiState.dndEnabled,
                onCheckedChange = { onToggleDnd() },
                testTag = "settings_dndSwitch",
            )
            if (uiState.dndEnabled) {
                var showStartTimePicker by remember { mutableStateOf(false) }
                var showEndTimePicker by remember { mutableStateOf(false) }

                Spacer(modifier = Modifier.height(8.dp))
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clickable { showStartTimePicker = true }
                            .testTag("settings_dndStartTime"),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = stringResource(Res.string.start),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        text = formatTime(uiState.dndStartHour, uiState.dndStartMinute),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }
                Spacer(modifier = Modifier.height(4.dp))
                Row(
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .clickable { showEndTimePicker = true }
                            .testTag("settings_dndEndTime"),
                    horizontalArrangement = Arrangement.SpaceBetween,
                    verticalAlignment = Alignment.CenterVertically,
                ) {
                    Text(
                        text = stringResource(Res.string.end),
                        style = MaterialTheme.typography.bodyMedium,
                    )
                    Text(
                        text = formatTime(uiState.dndEndHour, uiState.dndEndMinute),
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.primary,
                    )
                }

                if (showStartTimePicker) {
                    val startState =
                        rememberTimePickerState(
                            initialHour = uiState.dndStartHour,
                            initialMinute = uiState.dndStartMinute,
                        )
                    AlertDialog(
                        onDismissRequest = { showStartTimePicker = false },
                        title = { Text(stringResource(Res.string.dnd_start_time)) },
                        text = { TimePicker(state = startState) },
                        confirmButton = {
                            TextButton(
                                onClick = {
                                    onSetDndStartHour(startState.hour)
                                    onSetDndStartMinute(startState.minute)
                                    showStartTimePicker = false
                                },
                                modifier = Modifier.testTag("settings_dndStartConfirmButton"),
                            ) { Text(stringResource(Res.string.ok)) }
                        },
                        dismissButton = {
                            TextButton(
                                onClick = { showStartTimePicker = false },
                                modifier = Modifier.testTag("settings_dndStartCancelButton"),
                            ) { Text(stringResource(Res.string.cancel)) }
                        },
                    )
                }

                if (showEndTimePicker) {
                    val endState =
                        rememberTimePickerState(
                            initialHour = uiState.dndEndHour,
                            initialMinute = uiState.dndEndMinute,
                        )
                    AlertDialog(
                        onDismissRequest = { showEndTimePicker = false },
                        title = { Text(stringResource(Res.string.dnd_end_time)) },
                        text = { TimePicker(state = endState) },
                        confirmButton = {
                            TextButton(
                                onClick = {
                                    onSetDndEndHour(endState.hour)
                                    onSetDndEndMinute(endState.minute)
                                    showEndTimePicker = false
                                },
                                modifier = Modifier.testTag("settings_dndEndConfirmButton"),
                            ) { Text(stringResource(Res.string.ok)) }
                        },
                        dismissButton = {
                            TextButton(
                                onClick = { showEndTimePicker = false },
                                modifier = Modifier.testTag("settings_dndEndCancelButton"),
                            ) { Text(stringResource(Res.string.cancel)) }
                        },
                    )
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            Text(
                text = stringResource(Res.string.room_alerts),
                style = MaterialTheme.typography.titleSmall,
                color = MaterialTheme.colorScheme.primary,
            )
            Spacer(modifier = Modifier.height(4.dp))
            SettingsSwitch(
                title = stringResource(Res.string.self_destruct_countdown),
                description = stringResource(Res.string.self_destruct_description),
                checked = uiState.selfDestructAlertEnabled,
                onCheckedChange = { onToggleSelfDestructAlert() },
                testTag = "settings_selfDestructAlertSwitch",
            )

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

// ===== Permissions Page =====

@Composable
private fun PermissionsPage(
    onBack: () -> Unit,
    snackbarHostState: SnackbarHostState,
    platformSettings: PlatformSettingsService,
) {
    val notificationsEnabled = remember { platformSettings.areNotificationsEnabled() }
    val overlayEnabled = remember { platformSettings.canDrawOverlays() }
    val microphoneEnabled = remember { platformSettings.hasPermission("microphone") }
    val bluetoothEnabled = remember { platformSettings.hasPermission("bluetooth") }

    SettingsSubPage(
        title = stringResource(Res.string.permissions),
        onBack = onBack,
        snackbarHostState = snackbarHostState,
    ) { modifier ->
        Column(
            modifier = modifier.padding(horizontal = 16.dp),
        ) {
            Spacer(modifier = Modifier.height(8.dp))

            PermissionRow(
                title = stringResource(Res.string.notifications),
                description = stringResource(Res.string.notifications_permission_description),
                enabled = notificationsEnabled,
                onClick = {
                    platformSettings.openSystemSettings(SettingsType.NOTIFICATIONS)
                },
                testTag = "settings_notificationsPermission",
            )

            Spacer(modifier = Modifier.height(8.dp))

            PermissionRow(
                title = stringResource(Res.string.display_over_other_apps),
                description = stringResource(Res.string.overlay_permission_description),
                enabled = overlayEnabled,
                onClick = {
                    platformSettings.openSystemSettings(SettingsType.OVERLAY)
                },
                testTag = "settings_overlayPermission",
            )

            Spacer(modifier = Modifier.height(8.dp))

            PermissionRow(
                title = stringResource(Res.string.microphone),
                description = stringResource(Res.string.microphone_description),
                enabled = microphoneEnabled,
                onClick = {
                    platformSettings.openSystemSettings(SettingsType.MICROPHONE)
                },
                testTag = "settings_microphonePermission",
            )

            Spacer(modifier = Modifier.height(8.dp))

            PermissionRow(
                title = stringResource(Res.string.bluetooth),
                description = stringResource(Res.string.bluetooth_description),
                enabled = bluetoothEnabled,
                onClick = {
                    platformSettings.openSystemSettings(SettingsType.BLUETOOTH)
                },
                testTag = "settings_bluetoothPermission",
            )
        }
    }
}

@Composable
private fun PermissionRow(
    title: String,
    description: String,
    enabled: Boolean,
    onClick: () -> Unit,
    testTag: String = "",
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .clickable(onClick = onClick)
                .padding(vertical = 14.dp)
                .then(if (testTag.isNotEmpty()) Modifier.testTag(testTag) else Modifier),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(modifier = Modifier.width(8.dp))
        Text(
            text = if (enabled) stringResource(Res.string.allowed) else stringResource(Res.string.denied),
            style = MaterialTheme.typography.labelMedium,
            color = if (enabled) MaterialTheme.colorScheme.primary else MaterialTheme.colorScheme.error,
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
    onNavigateToCyberBullyingPolicy: () -> Unit,
    onCheckForUpdates: () -> Unit,
    onClearCache: () -> Unit,
    snackbarHostState: SnackbarHostState,
    platformSettings: PlatformSettingsService,
) {
    SettingsSubPage(
        title = stringResource(Res.string.about),
        onBack = onBack,
        snackbarHostState = snackbarHostState,
    ) { modifier ->
        Column(
            modifier =
                modifier
                    .verticalScroll(rememberScrollState())
                    .padding(horizontal = 16.dp),
        ) {
            // App icon + version
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(vertical = 8.dp),
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.spacedBy(12.dp),
            ) {
                val appIcon = remember { platformSettings.getAppIcon() }
                if (appIcon != null) {
                    Image(
                        painter = BitmapPainter(appIcon),
                        contentDescription = stringResource(Res.string.app_name_label),
                        modifier =
                            Modifier
                                .size(48.dp)
                                .clip(CircleShape),
                    )
                }
                Column {
                    Text(
                        text = "ShyTalk",
                        style = MaterialTheme.typography.titleMedium,
                    )
                    Text(
                        text = "v${platformSettings.getAppVersionName()}",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }

            Spacer(modifier = Modifier.height(4.dp))

            Text(
                text = stringResource(Res.string.shyden_ltd_brand),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )

            Spacer(modifier = Modifier.height(12.dp))

            // Contact
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clickable {
                            platformSettings.openEmail("shytalk.help@gmail.com")
                        }.padding(vertical = 12.dp)
                        .testTag("settings_contactUsLink"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(Res.string.contact_us),
                    style = MaterialTheme.typography.bodyLarge,
                )
                Spacer(modifier = Modifier.weight(1f))
                Text(
                    text = "shytalk.help@gmail.com",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.primary,
                )
            }

            // Privacy Policy
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clickable { onNavigateToPrivacyPolicy() }
                        .padding(vertical = 12.dp)
                        .testTag("settings_privacyPolicyLink"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(Res.string.privacy_policy),
                    style = MaterialTheme.typography.bodyLarge,
                )
            }

            // Community Standards
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clickable { onNavigateToCommunityStandards() }
                        .padding(vertical = 12.dp)
                        .testTag("settings_communityStandardsLink"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(Res.string.community_standards),
                    style = MaterialTheme.typography.bodyLarge,
                )
            }

            // Terms & Conditions
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clickable { onNavigateToTermsAndConditions() }
                        .padding(vertical = 12.dp)
                        .testTag("settings_termsAndConditionsLink"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(Res.string.terms_and_conditions),
                    style = MaterialTheme.typography.bodyLarge,
                )
            }

            // Cyber Bullying Policy
            Row(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clickable { onNavigateToCyberBullyingPolicy() }
                        .padding(vertical = 12.dp)
                        .testTag("settings_cyberBullyingPolicyLink"),
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(Res.string.cyber_bullying_policy),
                    style = MaterialTheme.typography.bodyLarge,
                )
            }

            // Check for Updates
            Spacer(modifier = Modifier.height(4.dp))
            OutlinedButton(
                onClick = onCheckForUpdates,
                enabled = !uiState.isCheckingUpdate,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .testTag("settings_checkForUpdatesButton"),
            ) {
                if (uiState.isCheckingUpdate) {
                    CircularProgressIndicator(modifier = Modifier.size(18.dp))
                    Spacer(modifier = Modifier.width(8.dp))
                }
                Text(stringResource(Res.string.check_for_updates))
            }

            Spacer(modifier = Modifier.height(16.dp))
            HorizontalDivider()
            Spacer(modifier = Modifier.height(16.dp))

            // Clear Cache
            OutlinedButton(
                onClick = onClearCache,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .testTag("settings_clearCacheButton"),
            ) {
                Text(stringResource(Res.string.clear_cache_with_size, formatCacheSize(uiState.cacheSizeBytes)))
            }

            Spacer(modifier = Modifier.height(32.dp))
        }
    }
}

// ===== Helper Composables =====

@Composable
private fun SettingsRow(
    label: String,
    value: String,
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = 8.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(
            text = label,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        Text(
            text = value,
            style = MaterialTheme.typography.bodyMedium,
        )
    }
}

@Composable
private fun SettingsSwitch(
    title: String,
    description: String,
    checked: Boolean,
    onCheckedChange: (Boolean) -> Unit,
    testTag: String = "",
) {
    Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .padding(vertical = 4.dp),
        horizontalArrangement = Arrangement.SpaceBetween,
        verticalAlignment = Alignment.CenterVertically,
    ) {
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = title,
                style = MaterialTheme.typography.bodyLarge,
            )
            Text(
                text = description,
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant,
            )
        }
        Spacer(modifier = Modifier.width(8.dp))
        Switch(
            checked = checked,
            onCheckedChange = onCheckedChange,
            modifier = if (testTag.isNotEmpty()) Modifier.testTag(testTag) else Modifier,
        )
    }
}
