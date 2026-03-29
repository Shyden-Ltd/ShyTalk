package com.shyden.shytalk.navigation

import android.Manifest
import android.content.Intent
import android.content.pm.PackageManager
import android.net.Uri
import android.os.Build
import android.provider.Settings
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.core.content.ContextCompat
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.NavController
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.google.firebase.messaging.FirebaseMessaging
import com.shyden.shytalk.core.crop.CropContract
import com.shyden.shytalk.core.crop.CropInput
import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.core.util.LanguagePreference
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.BillingService
import com.shyden.shytalk.data.remote.PmSyncService
import com.shyden.shytalk.data.remote.VoiceService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.NotificationRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.feature.auth.EmailOtpScreen
import com.shyden.shytalk.feature.auth.SignInScreen
import com.shyden.shytalk.feature.daily.DailyRewardCelebrationDialog
import com.shyden.shytalk.feature.daily.DailyRewardDialog
import com.shyden.shytalk.feature.daily.DailyRewardViewModel
import com.shyden.shytalk.feature.legal.CURRENT_LEGAL_VERSION
import com.shyden.shytalk.feature.legal.CommunityStandardsScreen
import com.shyden.shytalk.feature.legal.CyberBullyingPolicyScreen
import com.shyden.shytalk.feature.legal.LegalAcceptanceScreen
import com.shyden.shytalk.feature.legal.TermsAndConditionsScreen
import com.shyden.shytalk.feature.main.MainScreen
import com.shyden.shytalk.feature.messaging.ConversationListScreen
import com.shyden.shytalk.feature.messaging.ConversationListViewModel
import com.shyden.shytalk.feature.messaging.GroupSetupScreen
import com.shyden.shytalk.feature.messaging.GroupSetupViewModel
import com.shyden.shytalk.feature.messaging.NewMessageScreen
import com.shyden.shytalk.feature.messaging.PrivateChatScreen
import com.shyden.shytalk.feature.messaging.PrivateChatViewModel
import com.shyden.shytalk.feature.messaging.ReportReviewScreen
import com.shyden.shytalk.feature.privacy.PrivacyPolicyScreen
import com.shyden.shytalk.feature.profile.FollowListScreen
import com.shyden.shytalk.feature.profile.GiftWallScreen
import com.shyden.shytalk.feature.profile.GiftWallViewModel
import com.shyden.shytalk.feature.profile.ProfileScreen
import com.shyden.shytalk.feature.profile.ProfileSetupScreen
import com.shyden.shytalk.feature.profile.RequiredDOBScreen
import com.shyden.shytalk.feature.room.RoomScreen
import com.shyden.shytalk.feature.settings.AppSettingsScreen
import com.shyden.shytalk.feature.shop.TransactionHistoryScreen
import com.shyden.shytalk.feature.shop.TransactionHistoryViewModel
import com.shyden.shytalk.feature.shop.WalletScreen
import com.shyden.shytalk.feature.shop.WalletViewModel
import com.shyden.shytalk.feature.splash.FunFactSplashScreen
import com.shyden.shytalk.feature.splash.FunFactSplashViewModel
import com.shyden.shytalk.feature.warning.WarningScreen
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject

private fun NavController.safePopBackStack(): Boolean =
    if (previousBackStackEntry != null) {
        popBackStack()
    } else {
        false
    }

@Composable
fun NavGraph(
    navController: NavHostController,
    startDestination: String,
    isBackendDegraded: Boolean = false,
    pendingEmailLink: String? = null,
    onEmailLinkConsumed: () -> Unit = {},
    onSignOut: () -> Unit,
) {
    val activeRoomManager: RoomLifecycleManager = koinInject()
    val authRepository: AuthRepository = koinInject()
    var currentUserId by remember { mutableStateOf(authRepository.currentUserId) }

    // Re-sync after navigation (e.g., fresh sign-in updates currentUserId from null)
    LaunchedEffect(Unit) {
        navController.currentBackStackEntryFlow.collect {
            currentUserId = authRepository.currentUserId
        }
    }

    // Real-time suspension + warning listener
    val uid = currentUserId
    val userRepository: UserRepository = koinInject()
    if (uid != null) {
        LaunchedEffect(uid) {
            userRepository.observeUserFlags(uid).collect { flags ->
                if (flags.isSuspended) {
                    val endDate = flags.suspensionEndDate
                    val isActive =
                        endDate == null ||
                            endDate > System.currentTimeMillis()
                    if (isActive) {
                        onSignOut()
                        navController.navigate(Screen.SignIn.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    }
                }
                if (flags.hasActiveWarning) {
                    val currentRoute = navController.currentDestination?.route
                    if (currentRoute != Screen.Warning.route) {
                        navController.navigate(Screen.Warning.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    }
                }
            }
        }
    }

    fun navigateToRoom(roomId: String) {
        val currentRoomId = activeRoomManager.activeRoomId.value
        if (currentRoomId == roomId) {
            // Same room — pop back to it
            navController.popBackStack(Screen.Room.createRoute(roomId), false)
        } else {
            // Different room (or no room) — navigate and clear the old room from back stack
            navController.navigate(Screen.Room.createRoute(roomId)) {
                popUpTo(Screen.Main.route) { inclusive = false }
            }
        }
    }

    Box(modifier = Modifier.fillMaxSize()) {
        NavHost(
            navController = navController,
            startDestination = startDestination,
        ) {
            composable(Screen.SignIn.route) {
                SignInScreen(
                    pendingEmailLink = pendingEmailLink,
                    onEmailLinkConsumed = onEmailLinkConsumed,
                    onNavigateToEmail = {
                        navController.navigate(Screen.EmailSignIn.route)
                    },
                    onAuthSuccess = { hasProfile, hasDOB, needsLegalAcceptance ->
                        when {
                            !hasProfile ->
                                navController.navigate(Screen.ProfileSetup.route) {
                                    popUpTo(Screen.SignIn.route) { inclusive = true }
                                }
                            !hasDOB ->
                                navController.navigate(Screen.RequiredDOB.route) {
                                    popUpTo(Screen.SignIn.route) { inclusive = true }
                                }
                            needsLegalAcceptance -> {
                                navController.navigate(Screen.Splash.route) {
                                    popUpTo(Screen.SignIn.route) { inclusive = true }
                                }
                                navController.navigate(Screen.LegalAcceptance.route)
                            }
                            else ->
                                navController.navigate(Screen.Splash.route) {
                                    popUpTo(Screen.SignIn.route) { inclusive = true }
                                }
                        }
                    },
                )
            }

            composable(Screen.EmailSignIn.route) {
                val authViewModel: com.shyden.shytalk.feature.auth.AuthViewModel =
                    org.koin.compose.viewmodel
                        .koinViewModel()
                EmailOtpScreen(
                    onNavigateBack = { navController.safePopBackStack() },
                    onAuthSuccess = { customToken ->
                        authViewModel.signInWithCustomToken(customToken)
                    },
                )
            }

            composable(Screen.ProfileSetup.route) {
                ProfileSetupScreen(
                    onProfileComplete = {
                        navController.navigate(Screen.Splash.route) {
                            popUpTo(Screen.ProfileSetup.route) { inclusive = true }
                        }
                    },
                )
            }

            composable(Screen.RequiredDOB.route) {
                RequiredDOBScreen(
                    onComplete = {
                        navController.navigate(Screen.Splash.route) {
                            popUpTo(Screen.RequiredDOB.route) { inclusive = true }
                        }
                    },
                )
            }

            composable(Screen.Splash.route) {
                val splashViewModel: FunFactSplashViewModel =
                    org.koin.compose.viewmodel
                        .koinViewModel()
                val warmUpComplete by splashViewModel.warmUpComplete.collectAsStateWithLifecycle()
                val funFacts by splashViewModel.funFacts.collectAsStateWithLifecycle()
                FunFactSplashScreen(
                    warmUpComplete = warmUpComplete,
                    funFacts = funFacts,
                    onContinue = {
                        navController.navigate(Screen.Main.route) {
                            popUpTo(Screen.Splash.route) { inclusive = true }
                        }
                    },
                )
            }

            composable(Screen.Main.route) {
                // Request permissions once after login
                val context = LocalContext.current
                val userRepository: UserRepository = koinInject()
                val notificationRepository: NotificationRepository = koinInject()
                val scope = rememberCoroutineScope()
                var notificationPermissionRequested by rememberSaveable { mutableStateOf(false) }
                var showOverlayDialog by rememberSaveable { mutableStateOf(false) }

                val permissionLauncher =
                    rememberLauncherForActivityResult(
                        ActivityResultContracts.RequestMultiplePermissions(),
                    ) { /* granted or denied — no action needed */ }

                // Save FCM token on login
                LaunchedEffect(Unit) {
                    val userId = authRepository.currentUserId ?: return@LaunchedEffect
                    try {
                        val token = FirebaseMessaging.getInstance().token.await()
                        notificationRepository.saveFcmToken(userId, token)
                    } catch (e: Exception) {
                        Log.w("NavGraph", "FCM token save failed — will retry on next launch", e)
                    }
                }

                // Start PM sync service
                LaunchedEffect(Unit) {
                    try {
                        val syncIntent = Intent(context, PmSyncService::class.java)
                        androidx.core.content.ContextCompat
                            .startForegroundService(context, syncIntent)
                    } catch (e: Exception) {
                        Log.w("NavGraph", "PM sync service start failed", e)
                    }
                }

                // Only request system-level permissions from the production activity
                // (tests use bare ComponentActivity where these prompts block the UI)
                val isProductionApp = context is com.shyden.shytalk.MainActivity
                LaunchedEffect(Unit) {
                    if (!notificationPermissionRequested && isProductionApp) {
                        notificationPermissionRequested = true
                        val permissionsToRequest = mutableListOf<String>()
                        if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU &&
                            ContextCompat.checkSelfPermission(context, Manifest.permission.POST_NOTIFICATIONS) !=
                            PackageManager.PERMISSION_GRANTED
                        ) {
                            permissionsToRequest.add(Manifest.permission.POST_NOTIFICATIONS)
                        }
                        if (ContextCompat.checkSelfPermission(context, Manifest.permission.RECORD_AUDIO) !=
                            PackageManager.PERMISSION_GRANTED
                        ) {
                            permissionsToRequest.add(Manifest.permission.RECORD_AUDIO)
                        }
                        if (permissionsToRequest.isNotEmpty()) {
                            permissionLauncher.launch(permissionsToRequest.toTypedArray())
                        }
                        if (!Settings.canDrawOverlays(context)) {
                            showOverlayDialog = true
                        }
                    }
                }

                if (showOverlayDialog) {
                    AlertDialog(
                        onDismissRequest = { showOverlayDialog = false },
                        title = { Text(stringResource(Res.string.display_over_other_apps)) },
                        text = { Text(stringResource(Res.string.display_over_other_apps_description)) },
                        confirmButton = {
                            TextButton(onClick = {
                                showOverlayDialog = false
                                context.startActivity(
                                    Intent(
                                        Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                        Uri.parse("package:${context.packageName}"),
                                    ),
                                )
                            }) {
                                Text(stringResource(Res.string.allow))
                            }
                        },
                        dismissButton = {
                            TextButton(onClick = { showOverlayDialog = false }) {
                                Text(stringResource(Res.string.not_now))
                            }
                        },
                    )
                }

                val conversationListViewModel: ConversationListViewModel = koinInject()
                val dailyRewardViewModel: DailyRewardViewModel =
                    org.koin.compose.viewmodel
                        .koinViewModel()
                var showDailyRewardDialog by rememberSaveable { mutableStateOf(true) }
                val dailyRewardState by dailyRewardViewModel.uiState.collectAsState()

                // Trigger daily reward check when Main screen loads
                LaunchedEffect(Unit) {
                    val userId = authRepository.currentUserId ?: return@LaunchedEffect
                    when (val result = userRepository.getUser(userId)) {
                        is Resource.Success -> dailyRewardViewModel.checkAndShowDialog(result.data)
                        else -> {}
                    }
                }

                if (showDailyRewardDialog && dailyRewardState.showDialog && !dailyRewardState.hasClaimedToday) {
                    DailyRewardDialog(
                        viewModel = dailyRewardViewModel,
                        onDismiss = { showDailyRewardDialog = false },
                    )
                }

                if (dailyRewardState.showCelebration) {
                    DailyRewardCelebrationDialog(
                        viewModel = dailyRewardViewModel,
                        onDismiss = { showDailyRewardDialog = false },
                    )
                }

                val voiceService: VoiceService = koinInject()

                MainScreen(
                    isBackendDegraded = isBackendDegraded,
                    onNavigateToRoom = { roomId -> navigateToRoom(roomId) },
                    onPrewarmRoom = { room ->
                        val userId = authRepository.currentUserId
                        if (userId != null && room.voiceRoomName.isNotEmpty()) {
                            voiceService.prewarmToken(room.voiceRoomName, userId)
                        }
                    },
                    _onNavigateToUserProfile = { userId ->
                        navController.navigate(Screen.UserProfile.createRoute(userId))
                    },
                    _onNavigateToFollowList = { userId, tab ->
                        navController.navigate(Screen.FollowList.createRoute(userId, tab))
                    },
                    onNavigateToSettings = {
                        navController.navigate(Screen.Settings.route)
                    },
                    onNavigateToNewMessage = {
                        navController.navigate(Screen.NewMessage.route)
                    },
                    onNavigateToWallet = {
                        navController.navigate(Screen.Wallet.route)
                    },
                    onNavigateToUrl = { url ->
                        navController.navigate(Screen.Browser.createRoute(android.net.Uri.encode(url)))
                    },
                    messagesContent = { modifier ->
                        ConversationListScreen(
                            onNavigateToChat = { otherUserId ->
                                navController.navigate(Screen.PrivateChat.createRoute(otherUserId))
                            },
                            onNavigateToGroupChat = { conversationId ->
                                navController.navigate(Screen.GroupChat.createRoute(conversationId))
                            },
                            modifier = modifier,
                        )
                    },
                    totalUnreadCount =
                        conversationListViewModel.uiState
                            .collectAsState()
                            .value.totalUnreadCount,
                    profileContent = { modifier ->
                        ProfileScreen(
                            userId = null,
                            showBackButton = false,
                            onNavigateBack = {},
                            onNavigateToUserProfile = { userId ->
                                navController.navigate(Screen.UserProfile.createRoute(userId))
                            },
                            onNavigateToFollowList = { userId, tab ->
                                navController.navigate(Screen.FollowList.createRoute(userId, tab))
                            },
                            onNavigateToRoom = { roomId -> navigateToRoom(roomId) },
                            onNavigateToChat = { otherUserId ->
                                navController.navigate(Screen.PrivateChat.createRoute(otherUserId))
                            },
                            onNavigateToWallet = {
                                navController.navigate(Screen.Wallet.route)
                            },
                            modifier = modifier,
                        )
                    },
                )
            }

            composable(
                route = Screen.Room.route,
                arguments = listOf(navArgument("roomId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val roomId = backStackEntry.arguments?.getString("roomId") ?: return@composable
                RoomScreen(
                    roomId = roomId,
                    isBackendDegraded = isBackendDegraded,
                    onNavigateBack = { navController.safePopBackStack() },
                    onNavigateToUserProfile = { userId ->
                        navController.navigate(Screen.UserProfile.createRoute(userId))
                    },
                    onNavigateToChat = { otherUserId ->
                        navController.navigate(Screen.PrivateChat.createRoute(otherUserId))
                    },
                    onNavigateToWallet = {
                        navController.navigate(Screen.Wallet.route)
                    },
                )
            }

            composable(
                route = Screen.UserProfile.route,
                arguments = listOf(navArgument("userId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val userId = backStackEntry.arguments?.getString("userId") ?: return@composable
                ProfileScreen(
                    userId = userId,
                    onNavigateBack = { navController.safePopBackStack() },
                    onNavigateToUserProfile = { uid ->
                        navController.navigate(Screen.UserProfile.createRoute(uid))
                    },
                    onNavigateToFollowList = { uid, tab ->
                        navController.navigate(Screen.FollowList.createRoute(uid, tab))
                    },
                    onNavigateToRoom = { roomId -> navigateToRoom(roomId) },
                    onNavigateToChat = { otherUserId ->
                        navController.navigate(Screen.PrivateChat.createRoute(otherUserId))
                    },
                    onNavigateToWallet = {
                        navController.navigate(Screen.Wallet.route)
                    },
                )
            }

            composable(
                route = Screen.PrivateChat.route,
                arguments = listOf(navArgument("otherUserId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val otherUserId = backStackEntry.arguments?.getString("otherUserId") ?: return@composable
                val context = LocalContext.current
                val chatViewModel: PrivateChatViewModel =
                    org.koin.compose.viewmodel.koinViewModel(
                        key = otherUserId,
                    ) {
                        org.koin.core.parameter
                            .parametersOf(otherUserId)
                    }

                val imagePickerLauncher =
                    rememberLauncherForActivityResult(
                        ActivityResultContracts.PickMultipleVisualMedia(10),
                    ) { uris ->
                        if (uris.isNotEmpty()) {
                            val bytesList =
                                uris.mapNotNull { uri ->
                                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                                }
                            chatViewModel.uploadAndSendImages(bytesList)
                        }
                    }

                val stickerPickerLauncher =
                    rememberLauncherForActivityResult(
                        ActivityResultContracts.PickVisualMedia(),
                    ) { uri ->
                        if (uri != null) {
                            val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                            if (bytes != null) {
                                chatViewModel.addStickerFromImage(bytes)
                            }
                        }
                    }

                val activeRoomId by activeRoomManager.activeRoomId.collectAsState()
                val activeRoom by activeRoomManager.activeRoom.collectAsState()

                PrivateChatScreen(
                    otherUserId = otherUserId,
                    onNavigateBack = { navController.safePopBackStack() },
                    onNavigateToUserProfile = { uid ->
                        navController.navigate(Screen.UserProfile.createRoute(uid))
                    },
                    onPickImages = {
                        imagePickerLauncher.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                        )
                    },
                    onPickStickerImage = {
                        stickerPickerLauncher.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                        )
                    },
                    onNavigateToRoom = { roomId -> navigateToRoom(roomId) },
                    activeRoomId = activeRoomId,
                    activeRoomName = activeRoom?.name,
                    viewModel = chatViewModel,
                )
            }

            composable(
                route = Screen.FollowList.route,
                arguments =
                    listOf(
                        navArgument("userId") { type = NavType.StringType },
                        navArgument("tab") { type = NavType.StringType },
                    ),
            ) { backStackEntry ->
                val userId = backStackEntry.arguments?.getString("userId") ?: return@composable
                val tab = backStackEntry.arguments?.getString("tab") ?: "followers"
                FollowListScreen(
                    userId = userId,
                    tab = tab,
                    onNavigateBack = { navController.safePopBackStack() },
                    onNavigateToUserProfile = { uid ->
                        navController.navigate(Screen.UserProfile.createRoute(uid))
                    },
                    onNavigateToSuperShy = { navController.safePopBackStack() },
                )
            }

            composable(Screen.Settings.route) {
                val settingsNotificationRepo: NotificationRepository = koinInject()
                val settingsScope = rememberCoroutineScope()

                AppSettingsScreen(
                    onNavigateBack = { navController.safePopBackStack() },
                    onNavigateToPrivacyPolicy = {
                        navController.navigate(Screen.PrivacyPolicy.route)
                    },
                    onNavigateToCommunityStandards = {
                        navController.navigate(Screen.CommunityStandards.route)
                    },
                    onNavigateToTermsAndConditions = {
                        navController.navigate(Screen.TermsAndConditions.route)
                    },
                    onNavigateToCyberBullyingPolicy = {
                        navController.navigate(Screen.CyberBullyingPolicy.route)
                    },
                    onSignOut = {
                        // Remove FCM token before signing out
                        val signOutUserId = authRepository.currentUserId
                        if (signOutUserId != null) {
                            settingsScope.launch {
                                try {
                                    val token = FirebaseMessaging.getInstance().token.await()
                                    settingsNotificationRepo.removeFcmToken(signOutUserId, token)
                                } catch (e: Exception) {
                                    Log.w("NavGraph", "FCM token removal failed on sign-out", e)
                                }
                            }
                        }
                        // Stop PM sync service
                        try {
                            val ctx = navController.context
                            ctx.stopService(Intent(ctx, PmSyncService::class.java))
                        } catch (e: Exception) {
                            Log.d("NavGraph", "PM sync service stop failed", e)
                        }
                        onSignOut()
                        navController.navigate(Screen.SignIn.route) {
                            popUpTo(Screen.Main.route) { inclusive = true }
                        }
                    },
                )
            }

            composable(Screen.PrivacyPolicy.route) {
                PrivacyPolicyScreen(
                    onAccept = { navController.safePopBackStack() },
                    onDecline = { navController.safePopBackStack() },
                    onNavigateBack = { navController.safePopBackStack() },
                    showActions = false,
                )
            }

            composable(Screen.CommunityStandards.route) {
                CommunityStandardsScreen(
                    onNavigateBack = { navController.safePopBackStack() },
                )
            }

            composable(Screen.TermsAndConditions.route) {
                TermsAndConditionsScreen(
                    onNavigateBack = { navController.safePopBackStack() },
                )
            }

            composable(Screen.CyberBullyingPolicy.route) {
                CyberBullyingPolicyScreen(
                    onNavigateBack = { navController.safePopBackStack() },
                )
            }

            composable(Screen.LegalAcceptance.route) {
                val legalUserRepository: UserRepository = koinInject()
                val legalScope = rememberCoroutineScope()

                LegalAcceptanceScreen(
                    onAccept = {
                        legalScope.launch {
                            val userId = authRepository.currentUserId ?: return@launch
                            val result =
                                legalUserRepository.updateProfile(
                                    userId,
                                    mapOf(
                                        "acceptedLegalVersion" to CURRENT_LEGAL_VERSION,
                                        "legalAcceptedAt" to System.currentTimeMillis(),
                                    ),
                                )
                            if (result is Resource.Success) {
                                LanguagePreference.setAcceptedLegalVersion(CURRENT_LEGAL_VERSION)
                                navController.safePopBackStack()
                            }
                        }
                    },
                    onViewPrivacyPolicy = {
                        navController.navigate(Screen.PrivacyPolicy.route)
                    },
                    onViewCommunityStandards = {
                        navController.navigate(Screen.CommunityStandards.route)
                    },
                    onViewTerms = {
                        navController.navigate(Screen.TermsAndConditions.route)
                    },
                    onViewCyberBullyingPolicy = {
                        navController.navigate(Screen.CyberBullyingPolicy.route)
                    },
                )
            }

            composable(Screen.ReportReview.route) {
                ReportReviewScreen(
                    onNavigateBack = { navController.safePopBackStack() },
                )
            }

            composable(
                route = Screen.GroupChat.route,
                arguments = listOf(navArgument("conversationId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val cId = backStackEntry.arguments?.getString("conversationId") ?: return@composable
                val context = LocalContext.current
                val groupChatViewModel: PrivateChatViewModel =
                    org.koin.compose.viewmodel.koinViewModel(
                        key = cId,
                    ) {
                        org.koin.core.parameter
                            .parametersOf("", cId)
                    }

                val groupImagePickerLauncher =
                    rememberLauncherForActivityResult(
                        ActivityResultContracts.PickMultipleVisualMedia(10),
                    ) { uris ->
                        if (uris.isNotEmpty()) {
                            val bytesList =
                                uris.mapNotNull { uri ->
                                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                                }
                            groupChatViewModel.uploadAndSendImages(bytesList)
                        }
                    }

                val groupStickerPickerLauncher =
                    rememberLauncherForActivityResult(
                        ActivityResultContracts.PickVisualMedia(),
                    ) { uri ->
                        if (uri != null) {
                            val bytes = context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                            if (bytes != null) {
                                groupChatViewModel.addStickerFromImage(bytes)
                            }
                        }
                    }

                val groupActiveRoomId by activeRoomManager.activeRoomId.collectAsState()
                val groupActiveRoom by activeRoomManager.activeRoom.collectAsState()

                PrivateChatScreen(
                    conversationId = cId,
                    onNavigateBack = { navController.safePopBackStack() },
                    onNavigateToUserProfile = { uid ->
                        navController.navigate(Screen.UserProfile.createRoute(uid))
                    },
                    onPickImages = {
                        groupImagePickerLauncher.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                        )
                    },
                    onPickStickerImage = {
                        groupStickerPickerLauncher.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                        )
                    },
                    onNavigateToRoom = { roomId -> navigateToRoom(roomId) },
                    activeRoomId = groupActiveRoomId,
                    activeRoomName = groupActiveRoom?.name,
                    viewModel = groupChatViewModel,
                )
            }

            composable(Screen.NewMessage.route) {
                NewMessageScreen(
                    onNavigateBack = { navController.safePopBackStack() },
                    onNavigateToChat = { otherUserId ->
                        navController.navigate(Screen.PrivateChat.createRoute(otherUserId)) {
                            popUpTo(Screen.NewMessage.route) { inclusive = true }
                        }
                    },
                    onNavigateToGroupSetup = { selectedIds ->
                        navController.navigate(Screen.GroupSetup.createRoute(selectedIds))
                    },
                )
            }

            composable(
                route = Screen.GroupSetup.route,
                arguments = listOf(navArgument("selectedIds") { type = NavType.StringType }),
            ) { backStackEntry ->
                val selectedIds = backStackEntry.arguments?.getString("selectedIds") ?: return@composable
                val groupSetupContext = LocalContext.current
                val groupSetupViewModel: GroupSetupViewModel =
                    org.koin.compose.viewmodel.koinViewModel(
                        key = selectedIds,
                    ) {
                        org.koin.core.parameter
                            .parametersOf(selectedIds)
                    }

                val groupPhotoCropLauncher =
                    rememberLauncherForActivityResult(CropContract()) { uri ->
                        if (uri != null) {
                            val bytes =
                                try {
                                    groupSetupContext.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                                } catch (e: Exception) {
                                    Log.w("NavGraph", "Failed to read group photo", e)
                                    null
                                }
                            if (bytes != null) {
                                groupSetupViewModel.setGroupPhoto(bytes)
                            }
                        }
                    }

                val groupPhotoPickerLauncher =
                    rememberLauncherForActivityResult(PickVisualMedia()) { uri ->
                        if (uri != null) {
                            groupPhotoCropLauncher.launch(
                                CropInput(uri, 1, 1, "oval", 80, "Crop Group Photo"),
                            )
                        }
                    }

                GroupSetupScreen(
                    selectedIds = selectedIds,
                    onNavigateBack = { navController.safePopBackStack() },
                    onGroupCreated = { conversationId ->
                        navController.navigate(Screen.GroupChat.createRoute(conversationId)) {
                            popUpTo(Screen.NewMessage.route) { inclusive = true }
                        }
                    },
                    onPickGroupPhoto = {
                        groupPhotoPickerLauncher.launch(
                            PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly),
                        )
                    },
                    viewModel = groupSetupViewModel,
                )
            }

            composable(Screen.Wallet.route) {
                val walletViewModel: WalletViewModel =
                    org.koin.compose.viewmodel
                        .koinViewModel()
                val billingService: BillingService = koinInject()
                val walletContext = LocalContext.current
                val walletScope = rememberCoroutineScope()

                WalletScreen(
                    viewModel = walletViewModel,
                    onNavigateBack = { navController.safePopBackStack() },
                    onNavigateToTransactions = { navController.navigate(Screen.Transactions.route) },
                    onPurchasePackage = { pkg ->
                        walletScope.launch {
                            val products = billingService.queryProducts(listOf(pkg.productId))
                            val details = products.firstOrNull()
                            if (details != null) {
                                val activity = walletContext as android.app.Activity
                                billingService.launchPurchaseFlow(activity, details)
                            }
                        }
                    },
                    _onPurchaseSubscription = { productId ->
                        walletScope.launch {
                            val products =
                                billingService.queryProducts(
                                    listOf(productId),
                                    com.android.billingclient.api.BillingClient.ProductType.SUBS,
                                )
                            val details = products.firstOrNull()
                            if (details != null) {
                                val activity = walletContext as android.app.Activity
                                val offerToken = details.subscriptionOfferDetails?.firstOrNull()?.offerToken
                                billingService.launchPurchaseFlow(activity, details, offerToken)
                            }
                        }
                    },
                )
            }

            composable(Screen.Transactions.route) {
                val transactionHistoryViewModel: TransactionHistoryViewModel =
                    org.koin.compose.viewmodel
                        .koinViewModel()
                TransactionHistoryScreen(
                    viewModel = transactionHistoryViewModel,
                    onNavigateBack = { navController.safePopBackStack() },
                )
            }

            composable(
                route = Screen.GiftWall.route,
                arguments = listOf(navArgument("userId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val userId = backStackEntry.arguments?.getString("userId") ?: return@composable
                val giftWallViewModel: GiftWallViewModel =
                    org.koin.compose.viewmodel.koinViewModel(
                        key = userId,
                    ) {
                        org.koin.core.parameter
                            .parametersOf(userId)
                    }

                GiftWallScreen(
                    viewModel = giftWallViewModel,
                    onNavigateBack = { navController.safePopBackStack() },
                )
            }

            composable(
                route = Screen.Browser.route,
                arguments = listOf(navArgument("url") { type = NavType.StringType }),
            ) { backStackEntry ->
                val encodedUrl = backStackEntry.arguments?.getString("url") ?: return@composable
                val url = android.net.Uri.decode(encodedUrl)
                @OptIn(ExperimentalMaterial3Api::class)
                Scaffold(
                    topBar = {
                        TopAppBar(
                            title = { Text("") },
                            navigationIcon = {
                                IconButton(
                                    onClick = { navController.safePopBackStack() },
                                    modifier = Modifier.testTag("browser_backButton"),
                                ) {
                                    Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = stringResource(Res.string.back))
                                }
                            },
                        )
                    },
                ) { padding ->
                    com.shyden.shytalk.core.ui.PlatformWebView(
                        url = url,
                        modifier = Modifier.fillMaxSize().padding(padding),
                    )
                }
            }

            composable(Screen.Warning.route) {
                val warningUserRepo: UserRepository = koinInject()
                val warningScope = rememberCoroutineScope()

                // Read the warning reason from user doc
                var warningReason by remember { mutableStateOf<String?>(null) }
                LaunchedEffect(Unit) {
                    val userId = authRepository.currentUserId ?: return@LaunchedEffect
                    when (val result = warningUserRepo.getWarningReason(userId)) {
                        is Resource.Success -> warningReason = result.data
                        else -> {}
                    }
                }

                WarningScreen(
                    reason = warningReason,
                    onAccept = {
                        warningScope.launch {
                            val userId = authRepository.currentUserId ?: return@launch
                            warningUserRepo.acknowledgeWarning(userId)
                            navController.navigate(Screen.Main.route) {
                                popUpTo(Screen.Warning.route) { inclusive = true }
                            }
                        }
                    },
                    onViewCommunityStandards = {
                        navController.navigate(Screen.CommunityStandards.route)
                    },
                )
            }
        }
    } // Box
}
