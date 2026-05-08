package com.shyden.shytalk

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.dp
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.lifecycleScope
import androidx.navigation.compose.rememberNavController
import com.google.firebase.auth.FirebaseAuth
import com.shyden.shytalk.core.BuildVariant
import com.shyden.shytalk.core.PreviewWatermark
import com.shyden.shytalk.core.push.consumeChatDeepLink
import com.shyden.shytalk.core.push.verifyPushNavigation
import com.shyden.shytalk.core.room.ActiveRoomManager
import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.core.room.RoomService
import com.shyden.shytalk.core.util.DeviceSecurityChecker
import com.shyden.shytalk.core.util.LanguagePreference
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.AppConfigService
import com.shyden.shytalk.data.remote.StartingScreen
import com.shyden.shytalk.data.remote.WorkerApiClient
import com.shyden.shytalk.data.repository.AppLockRepository
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.feature.legal.CURRENT_LEGAL_VERSION
import com.shyden.shytalk.feature.legal.CommunityStandardsScreen
import com.shyden.shytalk.feature.legal.CyberBullyingPolicyScreen
import com.shyden.shytalk.feature.legal.LegalAcceptanceScreen
import com.shyden.shytalk.feature.legal.TermsAndConditionsScreen
import com.shyden.shytalk.feature.privacy.PrivacyPolicyScreen
import com.shyden.shytalk.feature.security.UnsafeDeviceScreen
import com.shyden.shytalk.feature.starting.StartingScreenCache
import com.shyden.shytalk.feature.starting.StartingScreenComposable
import com.shyden.shytalk.feature.update.DegradedModeScreen
import com.shyden.shytalk.feature.update.ForceUpdateScreen
import com.shyden.shytalk.navigation.NavGraph
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.koin.android.ext.android.inject

private const val TAG = "MainActivity"

class MainActivity : AppCompatActivity() {
    private val authRepository: AuthRepository by inject()
    private val userRepository: UserRepository by inject()
    private val privateMessageRepository: PrivateMessageRepository by inject()
    private val workerApiClient: WorkerApiClient by inject()
    private val activeRoomManager: RoomLifecycleManager by inject()
    private val appConfigService: AppConfigService by inject()
    private val biometricAuth: com.shyden.shytalk.core.util.BiometricAuth by inject()
    private val appLockRepository: AppLockRepository by inject()

    private val navigateToRoomState = mutableStateOf<String?>(null)
    private val navigateToChatState = mutableStateOf<Pair<String, Boolean>?>(null) // (id, isGroup)
    private val pendingEmailLinkState = mutableStateOf<String?>(null)
    private val showLeaveConfirmationState = mutableStateOf(false)
    private var lastSeenJob: Job? = null

    // Tracked so we can removeObserver in onDestroy. ProcessLifecycleOwner
    // is process-scoped, so observers registered in Activity onCreate
    // outlive the Activity. Without explicit removal, every config change
    // (rotation, locale switch via attachBaseContext) accumulates a new
    // observer, each independently calling appLockRepository on every
    // background transition.
    private var processLifecycleObserver: DefaultLifecycleObserver? = null

    override fun attachBaseContext(newBase: Context) {
        val language = LanguagePreference.get()
        val locale = java.util.Locale.forLanguageTag(language)
        java.util.Locale.setDefault(locale)
        val config = Configuration(newBase.resources.configuration).apply { setLocale(locale) }
        super.attachBaseContext(newBase.createConfigurationContext(config))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        BuildVariant.initLocalEmulator(
            value = BuildConfig.FLAVOR == "local",
            devPassword = BuildConfig.LOCAL_DEV_PASSWORD,
            devEmail = BuildConfig.LOCAL_DEV_EMAIL,
            googleWebClientId = BuildConfig.WEB_CLIENT_ID,
        )
        // Drives the PreviewWatermark overlay — non-prod builds get a
        // "ShyTalk Preview" badge on every screen so leaked screenshots
        // are unmistakably staging. Flavor maps directly to environment
        // ("prod" → no watermark; everything else → watermark).
        BuildVariant.initBuildInfo(
            environment = BuildConfig.FLAVOR,
            buildVersion = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
            deviceInfo = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} · Android ${android.os.Build.VERSION.RELEASE}",
        )
        biometricAuth.setActivity(this)
        enableEdgeToEdge()

        // Track app background/foreground for lock timeout. Save the
        // observer so it can be removed in onDestroy — ProcessLifecycleOwner
        // is process-scoped and would otherwise accumulate observers
        // across config-change Activity recreations.
        val observer =
            object : DefaultLifecycleObserver {
                override fun onStop(owner: LifecycleOwner) {
                    // App went to background — record timestamp
                    appLockRepository.updateLastActiveTimestamp()
                }
            }
        ProcessLifecycleOwner.get().lifecycle.addObserver(observer)
        processLifecycleObserver = observer

        setContent {
            ShyTalkTheme(darkTheme = true) {
                PreviewWatermark {
                    // Starting screen states (checked FIRST, before all other checks)
                    var startingScreenCheckDone by remember { mutableStateOf(false) }
                    var blockingScreen by remember { mutableStateOf<StartingScreen?>(null) }
                    var dismissableScreens by remember { mutableStateOf<List<StartingScreen>>(emptyList()) }
                    var blockingScreenDismissed by remember { mutableStateOf(false) }
                    var dismissableScreenIndex by remember { mutableStateOf(0) }

                    var updateRequired by remember { mutableStateOf(false) }
                    var checkComplete by remember { mutableStateOf(false) }
                    var softUpdateAvailable by remember { mutableStateOf<String?>(null) }
                    var isUnsafe by remember { mutableStateOf(false) }
                    var backendDegraded by remember { mutableStateOf(false) }
                    var degradedAcknowledged by remember { mutableStateOf(false) }
                    var legalAccepted by remember {
                        mutableStateOf(LanguagePreference.getAcceptedLegalVersion() >= CURRENT_LEGAL_VERSION)
                    }
                    var viewingLegalDoc by remember { mutableStateOf<String?>(null) }

                    val cache = remember { StartingScreenCache(this@MainActivity) }

                    // Starting screens check — runs FIRST before all other checks
                    LaunchedEffect(Unit) {
                        // Check cache first for immediate blocking
                        val cached = cache.getCachedBlocker()

                        when (val result = appConfigService.getStartingScreens()) {
                            is Resource.Success -> {
                                val screens = result.data
                                val enabledScreens = screens.values.filter { it.enabled }
                                val blocker = enabledScreens.firstOrNull { !it.dismissable }
                                if (blocker != null) {
                                    if (cached?.contentHash != blocker.contentHash) {
                                        cache.cacheBlocker(blocker, null)
                                    }
                                    blockingScreen = blocker
                                } else {
                                    cache.clearBlocker()
                                    dismissableScreens =
                                        enabledScreens
                                            .filter { it.dismissable }
                                            .filter { it.frequency != "once" || !cache.isDismissed(it.screenId) }
                                }
                            }

                            is Resource.Error -> {
                                if (cached != null) {
                                    blockingScreen = cached.toStartingScreen()
                                }
                            }

                            is Resource.Loading -> { /* wait */ }
                        }
                        startingScreenCheckDone = true
                    }

                    // Existing update/health checks — only runs after starting screen check passes
                    LaunchedEffect(startingScreenCheckDone) {
                        if (!startingScreenCheckDone) return@LaunchedEffect
                        // Don't run further checks if blocked
                        if (blockingScreen != null) return@LaunchedEffect

                        isUnsafe = DeviceSecurityChecker.isUnsafe()
                        when (val result = appConfigService.getLatestVersionInfo()) {
                            is Resource.Success -> {
                                val (minVersionCode, latestVersionCode, latestVersionName) = result.data
                                updateRequired = appConfigService.currentVersionCode < minVersionCode
                                if (!updateRequired && appConfigService.currentVersionCode < latestVersionCode) {
                                    softUpdateAvailable = latestVersionName.ifEmpty { "v$latestVersionCode" }
                                }
                            }

                            is Resource.Error -> {
                                updateRequired = false
                            }

                            is Resource.Loading -> { /* wait */ }
                        }
                        when (val healthResult = appConfigService.checkBackendHealth()) {
                            is Resource.Success -> {
                                backendDegraded = healthResult.data.status == "degraded"
                            }

                            else -> {}
                        }
                        checkComplete = true
                    }

                    // Poll health every 5 minutes while degraded; clear when recovered
                    LaunchedEffect(backendDegraded) {
                        if (!backendDegraded) return@LaunchedEffect
                        while (true) {
                            delay(300_000L) // 5 minutes
                            when (val result = appConfigService.checkBackendHealth()) {
                                is Resource.Success -> {
                                    if (result.data.status == "ok") {
                                        backendDegraded = false
                                        return@LaunchedEffect
                                    }
                                }

                                else -> {} // still degraded
                            }
                        }
                    }

                    when {
                        !startingScreenCheckDone -> {
                            // Loading spinner while checking starting screens
                            Surface(
                                color = MaterialTheme.colorScheme.background,
                                modifier = Modifier.fillMaxSize(),
                            ) {
                                Column(
                                    modifier = Modifier.fillMaxSize(),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.Center,
                                ) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(24.dp),
                                        strokeWidth = 2.dp,
                                        color = MaterialTheme.colorScheme.primary,
                                    )
                                    Spacer(modifier = Modifier.height(12.dp))
                                    Text(
                                        text = stringResource(Res.string.starting_screen_loading),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }

                        blockingScreen != null && !blockingScreenDismissed -> {
                            // Blocking screen — STOPS all further loading
                            StartingScreenComposable(
                                screen = blockingScreen!!,
                                onDismiss = { blockingScreenDismissed = true },
                            )
                        }

                        !checkComplete -> {
                            Surface(
                                color = MaterialTheme.colorScheme.background,
                                modifier = Modifier.fillMaxSize(),
                            ) {
                                Column(
                                    modifier = Modifier.fillMaxSize(),
                                    horizontalAlignment = Alignment.CenterHorizontally,
                                    verticalArrangement = Arrangement.Center,
                                ) {
                                    CircularProgressIndicator(
                                        modifier = Modifier.size(24.dp),
                                        strokeWidth = 2.dp,
                                        color = MaterialTheme.colorScheme.primary,
                                    )
                                    Spacer(modifier = Modifier.height(12.dp))
                                    Text(
                                        text = stringResource(Res.string.checking_for_updates),
                                        style = MaterialTheme.typography.bodyMedium,
                                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                                    )
                                }
                            }
                        }

                        isUnsafe -> {
                            UnsafeDeviceScreen()
                        }

                        updateRequired -> {
                            ForceUpdateScreen()
                        }

                        backendDegraded && !degradedAcknowledged -> {
                            DegradedModeScreen(onAcknowledge = { degradedAcknowledged = true })
                        }

                        !legalAccepted -> {
                            when (viewingLegalDoc) {
                                "privacy" ->
                                    PrivacyPolicyScreen(
                                        onAccept = {},
                                        onDecline = {},
                                        onNavigateBack = { viewingLegalDoc = null },
                                        showActions = false,
                                    )

                                "community" ->
                                    CommunityStandardsScreen(
                                        onNavigateBack = { viewingLegalDoc = null },
                                    )

                                "terms" ->
                                    TermsAndConditionsScreen(
                                        onNavigateBack = { viewingLegalDoc = null },
                                    )

                                "cyberbullying" ->
                                    CyberBullyingPolicyScreen(
                                        onNavigateBack = { viewingLegalDoc = null },
                                    )

                                else ->
                                    LegalAcceptanceScreen(
                                        onAccept = {
                                            LanguagePreference.setAcceptedLegalVersion(CURRENT_LEGAL_VERSION)
                                            legalAccepted = true
                                        },
                                        onViewPrivacyPolicy = { viewingLegalDoc = "privacy" },
                                        onViewCommunityStandards = { viewingLegalDoc = "community" },
                                        onViewTerms = { viewingLegalDoc = "terms" },
                                        onViewCyberBullyingPolicy = { viewingLegalDoc = "cyberbullying" },
                                    )
                            }
                        }

                        dismissableScreens.isNotEmpty() && dismissableScreenIndex < dismissableScreens.size -> {
                            val currentScreen = dismissableScreens[dismissableScreenIndex]
                            StartingScreenComposable(
                                screen = currentScreen,
                                onDismiss = {
                                    if (currentScreen.frequency == "once") {
                                        cache.markDismissed(currentScreen.screenId)
                                    }
                                    dismissableScreenIndex++
                                },
                            )
                        }

                        else -> {
                            val navController = rememberNavController()
                            val navigateToRoomId by navigateToRoomState

                            LaunchedEffect(navigateToRoomId) {
                                val roomId = navigateToRoomId
                                if (roomId != null) {
                                    navController.navigate(Screen.Room.createRoute(roomId)) {
                                        launchSingleTop = true
                                    }
                                    navigateToRoomState.value = null
                                }
                            }

                            val navigateToChatInfo by navigateToChatState

                            // Push deep-link authorisation re-check — delegates to
                            // commonMain `verifyPushNavigation` so iOS and Android
                            // share the same authz semantics (timeout, identity
                            // gate, block-list gate, group conversation-membership
                            // gate; all fail-closed). Use `resolvedUniqueId`
                            // explicitly to avoid the cold-start race where
                            // `currentUserId` falls back to the Firebase UID
                            // before identity resolution completes.
                            LaunchedEffect(navigateToChatInfo) {
                                val chatInfo = navigateToChatInfo
                                if (chatInfo != null) {
                                    val (id, isGroup) = chatInfo
                                    val currentUserId = authRepository.resolvedUniqueId
                                    if (currentUserId.isNullOrEmpty()) {
                                        Log.w(TAG, "Push deep-link dropped — identity not yet resolved or signed out")
                                        navigateToChatState.value = null
                                        return@LaunchedEffect
                                    }
                                    val authzOk =
                                        verifyPushNavigation(
                                            currentUserId = currentUserId,
                                            targetId = id,
                                            isGroup = isGroup,
                                            fetchBlockedUserIds = { userRepository.getBlockedUserIds(it) },
                                            fetchConversation = { privateMessageRepository.getConversation(it) },
                                        )
                                    if (!authzOk) {
                                        navigateToChatState.value = null
                                        return@LaunchedEffect
                                    }
                                    val route =
                                        if (isGroup) {
                                            Screen.GroupChat.createRoute(id)
                                        } else {
                                            Screen.PrivateChat.createRoute(id)
                                        }
                                    navController.navigate(route) {
                                        launchSingleTop = true
                                    }
                                    navigateToChatState.value = null
                                    // Also clear the shared chatDeepLinks bus so a
                                    // future tri-platform unification through that
                                    // channel doesn't leave a stale link. Idempotent.
                                    consumeChatDeepLink()
                                }
                            }

                            val pendingEmailLink by pendingEmailLinkState

                            // Skip sign-in screen if already authenticated (prevents login flash)
                            val initialRoute =
                                if (
                                    authRepository.isAuthenticated &&
                                    appLockRepository.hasCredential &&
                                    authRepository.currentUserId != null
                                ) {
                                    Screen.Main.route
                                } else {
                                    Screen.SignIn.route
                                }

                            NavGraph(
                                navController = navController,
                                startDestination = initialRoute,
                                isBackendDegraded = backendDegraded,
                                pendingEmailLink = pendingEmailLink,
                                onEmailLinkConsumed = { pendingEmailLinkState.value = null },
                                onSignOut = {
                                    workerApiClient.clearTokenCache()
                                    // Process-scoped: sign-out must finish even if this
                                    // Activity is destroyed by the navigation it triggers.
                                    // Rethrow CancellationException to keep structured
                                    // concurrency intact when the scope is cancelled.
                                    ProcessLifecycleOwner.get().lifecycleScope.launch {
                                        try {
                                            authRepository.signOut()
                                        } catch (e: CancellationException) {
                                            throw e
                                        } catch (e: Exception) {
                                            Log.e(TAG, "authRepository.signOut() failed: ${e.message}", e)
                                        }
                                    }
                                },
                            )

                            softUpdateAvailable?.let { version ->
                                AlertDialog(
                                    onDismissRequest = { softUpdateAvailable = null },
                                    title = { Text(stringResource(Res.string.update_available)) },
                                    text = { Text(stringResource(Res.string.update_available_soft, version)) },
                                    confirmButton = {
                                        TextButton(onClick = {
                                            softUpdateAvailable = null
                                            startActivity(
                                                Intent(
                                                    Intent.ACTION_VIEW,
                                                    Uri.parse("https://play.google.com/store/apps/details?id=com.shyden.shytalk"),
                                                ),
                                            )
                                        }) { Text(stringResource(Res.string.update_now)) }
                                    },
                                    dismissButton = {
                                        TextButton(onClick = { softUpdateAvailable = null }) {
                                            Text(stringResource(Res.string.later))
                                        }
                                    },
                                )
                            }
                        }
                    }

                    // Leave room confirmation dialog (triggered by chathead X tap)
                    val showLeaveDialog by showLeaveConfirmationState
                    if (showLeaveDialog) {
                        val isOwner = activeRoomManager.activeRoom.value?.ownerId == activeRoomManager.currentUserId
                        AlertDialog(
                            onDismissRequest = { showLeaveConfirmationState.value = false },
                            title = {
                                Text(
                                    if (isOwner) {
                                        stringResource(
                                            Res.string.close_room_question,
                                        )
                                    } else {
                                        stringResource(Res.string.leave_room_question)
                                    },
                                )
                            },
                            text = {
                                Text(
                                    if (isOwner) {
                                        stringResource(Res.string.close_room_description)
                                    } else {
                                        stringResource(Res.string.leave_room_description)
                                    },
                                )
                            },
                            confirmButton = {
                                TextButton(onClick = {
                                    showLeaveConfirmationState.value = false
                                    val intent =
                                        Intent(this@MainActivity, RoomService::class.java).apply {
                                            action = "CONFIRM_DISMISS"
                                        }
                                    startService(intent)
                                }) { Text(stringResource(Res.string.leave)) }
                            },
                            dismissButton = {
                                TextButton(onClick = { showLeaveConfirmationState.value = false }) {
                                    Text(stringResource(Res.string.cancel))
                                }
                            },
                        )
                    }
                }
            }
        }

        // Handle notification tap to open room (cold start)
        handleRoomIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        activeRoomManager.isAppInForeground = true
        startLastSeenUpdates()
    }

    override fun onStop() {
        super.onStop()
        activeRoomManager.isAppInForeground = false
        lastSeenJob?.cancel()
        lastSeenJob = null
    }

    private fun startLastSeenUpdates() {
        lastSeenJob?.cancel()
        lastSeenJob =
            CoroutineScope(Dispatchers.IO).launch {
                while (isActive) {
                    authRepository.currentUserId?.let { uid ->
                        userRepository.updateLastSeen(uid)
                    }
                    delay(LAST_SEEN_INTERVAL_MS)
                }
            }
    }

    companion object {
        private const val LAST_SEEN_INTERVAL_MS = 180_000L // 3 minutes
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleRoomIntent(intent)
    }

    private fun handleRoomIntent(intent: Intent?) {
        intent ?: return

        // Handle email sign-in deep link
        val data = intent.data?.toString()
        if (data != null && FirebaseAuth.getInstance().isSignInWithEmailLink(data)) {
            pendingEmailLinkState.value = data
            return
        }

        // Handle PM notification tap (navigateTo=chat)
        val navigateTo = intent.getStringExtra("navigateTo")
        if (navigateTo == "chat") {
            val isGroup = intent.getBooleanExtra("isGroup", false)
            val inRoom = activeRoomManager.activeRoomId.value != null

            if (inRoom) {
                // User is in a room — open PmBottomSheet within the room instead of navigating away
                val mgr = activeRoomManager as? ActiveRoomManager
                if (isGroup) {
                    val conversationId = intent.getStringExtra("conversationId")
                    if (conversationId != null) mgr?.requestOpenPm(groupConversationId = conversationId)
                } else {
                    val otherUserId = intent.getStringExtra("otherUserId")
                    if (otherUserId != null) mgr?.requestOpenPm(userId = otherUserId)
                }
            } else {
                if (isGroup) {
                    val conversationId = intent.getStringExtra("conversationId")
                    if (conversationId != null) {
                        navigateToChatState.value = conversationId to true
                    }
                } else {
                    val otherUserId = intent.getStringExtra("otherUserId")
                    if (otherUserId != null) {
                        navigateToChatState.value = otherUserId to false
                    }
                }
            }
            return
        }

        when (intent.action) {
            "OPEN_ROOM" -> {
                val roomId = intent.getStringExtra("roomId")
                if (roomId != null) {
                    navigateToRoomState.value = roomId
                }
            }

            "CONFIRM_LEAVE_ROOM" -> {
                showLeaveConfirmationState.value = true
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        processLifecycleObserver?.let {
            ProcessLifecycleOwner.get().lifecycle.removeObserver(it)
        }
        processLifecycleObserver = null
    }
}
