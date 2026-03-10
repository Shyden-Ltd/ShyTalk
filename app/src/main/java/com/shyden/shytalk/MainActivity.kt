package com.shyden.shytalk

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
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
import androidx.navigation.compose.rememberNavController
import com.shyden.shytalk.core.room.ActiveRoomManager
import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.core.room.RoomService
import com.shyden.shytalk.data.remote.WorkerApiClient
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import com.shyden.shytalk.core.util.DeviceSecurityChecker
import com.shyden.shytalk.core.util.LanguagePreference
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.AppConfigService
import com.shyden.shytalk.feature.legal.CURRENT_LEGAL_VERSION
import com.shyden.shytalk.feature.legal.LegalAcceptanceScreen
import com.shyden.shytalk.feature.legal.CommunityStandardsScreen
import com.shyden.shytalk.feature.legal.CyberBullyingPolicyScreen
import com.shyden.shytalk.feature.legal.TermsAndConditionsScreen
import com.shyden.shytalk.feature.privacy.PrivacyPolicyScreen
import com.shyden.shytalk.feature.security.UnsafeDeviceScreen
import com.shyden.shytalk.feature.update.DegradedModeScreen
import com.shyden.shytalk.feature.update.ForceUpdateScreen
import com.shyden.shytalk.navigation.NavGraph
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import org.jetbrains.compose.resources.stringResource
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.*
import org.koin.android.ext.android.inject

class MainActivity : ComponentActivity() {

    private val authRepository: AuthRepository by inject()
    private val userRepository: UserRepository by inject()
    private val workerApiClient: WorkerApiClient by inject()
    private val activeRoomManager: RoomLifecycleManager by inject()
    private val appConfigService: AppConfigService by inject()

    private val _navigateToRoom = mutableStateOf<String?>(null)
    private val _navigateToChat = mutableStateOf<Pair<String, Boolean>?>(null) // (id, isGroup)
    private val _showLeaveConfirmation = mutableStateOf(false)
    private var lastSeenJob: Job? = null

    override fun attachBaseContext(newBase: Context) {
        val language = LanguagePreference.get()
        val locale = java.util.Locale.forLanguageTag(language)
        java.util.Locale.setDefault(locale)
        val config = Configuration(newBase.resources.configuration).apply { setLocale(locale) }
        super.attachBaseContext(newBase.createConfigurationContext(config))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            ShyTalkTheme(darkTheme = true) {
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

                LaunchedEffect(Unit) {
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
                    !checkComplete -> {
                        Surface(
                            color = MaterialTheme.colorScheme.background,
                            modifier = Modifier.fillMaxSize()
                        ) {
                            Column(
                                modifier = Modifier.fillMaxSize(),
                                horizontalAlignment = Alignment.CenterHorizontally,
                                verticalArrangement = Arrangement.Center
                            ) {
                                CircularProgressIndicator(
                                    modifier = Modifier.size(24.dp),
                                    strokeWidth = 2.dp,
                                    color = MaterialTheme.colorScheme.primary
                                )
                                Spacer(modifier = Modifier.height(12.dp))
                                Text(
                                    text = stringResource(Res.string.checking_for_updates),
                                    style = MaterialTheme.typography.bodyMedium,
                                    color = MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                    isUnsafe -> { UnsafeDeviceScreen() }
                    updateRequired -> { ForceUpdateScreen() }
                    backendDegraded && !degradedAcknowledged -> {
                        DegradedModeScreen(onAcknowledge = { degradedAcknowledged = true })
                    }
                    !legalAccepted -> {
                        when (viewingLegalDoc) {
                            "privacy" -> PrivacyPolicyScreen(
                                onAccept = {},
                                onDecline = {},
                                onNavigateBack = { viewingLegalDoc = null },
                                showActions = false
                            )
                            "community" -> CommunityStandardsScreen(
                                onNavigateBack = { viewingLegalDoc = null }
                            )
                            "terms" -> TermsAndConditionsScreen(
                                onNavigateBack = { viewingLegalDoc = null }
                            )
                            "cyberbullying" -> CyberBullyingPolicyScreen(
                                onNavigateBack = { viewingLegalDoc = null }
                            )
                            else -> LegalAcceptanceScreen(
                                onAccept = {
                                    LanguagePreference.setAcceptedLegalVersion(CURRENT_LEGAL_VERSION)
                                    legalAccepted = true
                                },
                                onViewPrivacyPolicy = { viewingLegalDoc = "privacy" },
                                onViewCommunityStandards = { viewingLegalDoc = "community" },
                                onViewTerms = { viewingLegalDoc = "terms" },
                                onViewCyberBullyingPolicy = { viewingLegalDoc = "cyberbullying" }
                            )
                        }
                    }
                    else -> {
                            val navController = rememberNavController()
                            val navigateToRoomId by _navigateToRoom

                            LaunchedEffect(navigateToRoomId) {
                                val roomId = navigateToRoomId
                                if (roomId != null) {
                                    navController.navigate(Screen.Room.createRoute(roomId)) {
                                        launchSingleTop = true
                                    }
                                    _navigateToRoom.value = null
                                }
                            }

                            val navigateToChatInfo by _navigateToChat

                            LaunchedEffect(navigateToChatInfo) {
                                val chatInfo = navigateToChatInfo
                                if (chatInfo != null) {
                                    val (id, isGroup) = chatInfo
                                    val route = if (isGroup) {
                                        Screen.GroupChat.createRoute(id)
                                    } else {
                                        Screen.PrivateChat.createRoute(id)
                                    }
                                    navController.navigate(route) {
                                        launchSingleTop = true
                                    }
                                    _navigateToChat.value = null
                                }
                            }

                            NavGraph(
                                navController = navController,
                                startDestination = Screen.SignIn.route,
                                isBackendDegraded = backendDegraded,
                                onSignOut = {
                                    workerApiClient.clearTokenCache()
                                    authRepository.signOut()
                                }
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
                                                    Uri.parse("https://play.google.com/store/apps/details?id=com.shyden.shytalk")
                                                )
                                            )
                                        }) { Text(stringResource(Res.string.update_now)) }
                                    },
                                    dismissButton = {
                                        TextButton(onClick = { softUpdateAvailable = null }) {
                                            Text(stringResource(Res.string.later))
                                        }
                                    }
                                )
                            }
                    }
                }

                // Leave room confirmation dialog (triggered by chathead X tap)
                val showLeaveDialog by _showLeaveConfirmation
                if (showLeaveDialog) {
                    val isOwner = activeRoomManager.activeRoom.value?.ownerId == activeRoomManager.currentUserId
                    AlertDialog(
                        onDismissRequest = { _showLeaveConfirmation.value = false },
                        title = { Text(if (isOwner) stringResource(Res.string.close_room_question) else stringResource(Res.string.leave_room_question)) },
                        text = { Text(
                            if (isOwner) stringResource(Res.string.close_room_description)
                            else stringResource(Res.string.leave_room_description)
                        ) },
                        confirmButton = {
                            TextButton(onClick = {
                                _showLeaveConfirmation.value = false
                                val intent = Intent(this@MainActivity, RoomService::class.java).apply {
                                    action = "CONFIRM_DISMISS"
                                }
                                startService(intent)
                            }) { Text(stringResource(Res.string.leave)) }
                        },
                        dismissButton = {
                            TextButton(onClick = { _showLeaveConfirmation.value = false }) {
                                Text(stringResource(Res.string.cancel))
                            }
                        }
                    )
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
        lastSeenJob = CoroutineScope(Dispatchers.IO).launch {
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
                        _navigateToChat.value = conversationId to true
                    }
                } else {
                    val otherUserId = intent.getStringExtra("otherUserId")
                    if (otherUserId != null) {
                        _navigateToChat.value = otherUserId to false
                    }
                }
            }
            return
        }

        when (intent.action) {
            "OPEN_ROOM" -> {
                val roomId = intent.getStringExtra("roomId")
                if (roomId != null) {
                    _navigateToRoom.value = roomId
                }
            }
            "CONFIRM_LEAVE_ROOM" -> {
                _showLeaveConfirmation.value = true
            }
        }
    }
}
