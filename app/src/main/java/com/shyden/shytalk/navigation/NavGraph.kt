package com.shyden.shytalk.navigation

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavController
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.room.ActiveRoomManager
import com.shyden.shytalk.data.repository.AuthRepository
import com.google.firebase.messaging.FirebaseMessaging
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.NotificationRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.data.remote.PmSyncService
import com.shyden.shytalk.feature.auth.GoogleSignInScreen
import com.shyden.shytalk.feature.home.LunarNewYearScreen
import com.shyden.shytalk.feature.legal.CURRENT_LEGAL_VERSION
import com.shyden.shytalk.feature.legal.CommunityStandardsScreen
import com.shyden.shytalk.feature.legal.LegalAcceptanceScreen
import com.shyden.shytalk.feature.legal.TermsAndConditionsScreen
import com.shyden.shytalk.feature.main.MainScreen
import com.shyden.shytalk.feature.messaging.ConversationListScreen
import com.shyden.shytalk.feature.messaging.ConversationListViewModel
import com.shyden.shytalk.feature.messaging.GroupSetupScreen
import com.shyden.shytalk.feature.messaging.GroupSetupViewModel
import com.shyden.shytalk.feature.messaging.NewMessageScreen
import com.shyden.shytalk.core.crop.CropContract
import com.shyden.shytalk.core.crop.CropInput
import androidx.activity.result.contract.ActivityResultContracts.PickVisualMedia
import com.shyden.shytalk.feature.messaging.PrivateChatScreen
import com.shyden.shytalk.feature.messaging.PrivateChatViewModel
import com.shyden.shytalk.feature.messaging.ReportReviewScreen
import com.shyden.shytalk.feature.privacy.PrivacyPolicyScreen
import com.shyden.shytalk.feature.settings.AppSettingsScreen
import com.shyden.shytalk.feature.profile.FollowListScreen
import com.shyden.shytalk.feature.profile.ProfileScreen
import com.shyden.shytalk.feature.profile.GiftWallScreen
import com.shyden.shytalk.feature.profile.GiftWallViewModel
import com.shyden.shytalk.feature.profile.ProfileSetupScreen
import com.shyden.shytalk.feature.profile.RequiredDOBScreen
import com.shyden.shytalk.feature.shop.TransactionHistoryScreen
import com.shyden.shytalk.feature.shop.TransactionHistoryViewModel
import com.shyden.shytalk.feature.shop.WalletScreen
import com.shyden.shytalk.feature.shop.WalletViewModel
import com.shyden.shytalk.feature.daily.DailyRewardDialog
import com.shyden.shytalk.feature.daily.DailyRewardViewModel
import com.shyden.shytalk.data.remote.BillingService
import com.shyden.shytalk.feature.room.RoomScreen
import com.shyden.shytalk.feature.warning.WarningScreen
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import org.koin.compose.koinInject

private fun NavController.safePopBackStack(): Boolean {
    return if (previousBackStackEntry != null) {
        popBackStack()
    } else {
        false
    }
}

@Composable
fun NavGraph(
    navController: NavHostController,
    startDestination: String,
    onSignOut: () -> Unit
) {
    val activeRoomManager: ActiveRoomManager = koinInject()
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
    if (uid != null) {
        DisposableEffect(uid) {
            val listener = FirebaseFirestore.getInstance()
                .collection("users")
                .document(uid)
                .addSnapshotListener { snapshot, _ ->
                    if (snapshot?.getBoolean("isSuspended") == true) {
                        val endTimestamp = snapshot.getTimestamp("suspensionEndDate")
                        val isActive = endTimestamp == null ||
                            endTimestamp.toDate().time > System.currentTimeMillis()
                        if (isActive) {
                            onSignOut()
                            navController.navigate(Screen.SignIn.route) {
                                popUpTo(0) { inclusive = true }
                            }
                        }
                    }
                    // Check for active warning — navigate to warning screen
                    if (snapshot?.getBoolean("hasActiveWarning") == true) {
                        val currentRoute = navController.currentDestination?.route
                        if (currentRoute != Screen.Warning.route) {
                            navController.navigate(Screen.Warning.route) {
                                popUpTo(0) { inclusive = true }
                            }
                        }
                    }
                }
            onDispose { listener.remove() }
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

    NavHost(
        navController = navController,
        startDestination = startDestination
    ) {
        composable(Screen.SignIn.route) {
            GoogleSignInScreen(
                onAuthSuccess = { hasProfile, hasDOB ->
                    when {
                        !hasProfile -> navController.navigate(Screen.ProfileSetup.route) {
                            popUpTo(Screen.SignIn.route) { inclusive = true }
                        }
                        !hasDOB -> navController.navigate(Screen.RequiredDOB.route) {
                            popUpTo(Screen.SignIn.route) { inclusive = true }
                        }
                        else -> navController.navigate(Screen.Main.route) {
                            popUpTo(Screen.SignIn.route) { inclusive = true }
                        }
                    }
                }
            )
        }

        composable(Screen.ProfileSetup.route) {
            ProfileSetupScreen(
                onProfileComplete = {
                    navController.navigate(Screen.Main.route) {
                        popUpTo(Screen.ProfileSetup.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.RequiredDOB.route) {
            RequiredDOBScreen(
                onComplete = {
                    navController.navigate(Screen.Main.route) {
                        popUpTo(Screen.RequiredDOB.route) { inclusive = true }
                    }
                }
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
            var legalCheckDone by rememberSaveable { mutableStateOf(false) }

            val notificationPermissionLauncher = rememberLauncherForActivityResult(
                ActivityResultContracts.RequestPermission()
            ) { /* granted or denied — no action needed */ }

            // Legal acceptance check
            LaunchedEffect(Unit) {
                if (!legalCheckDone) {
                    val userId = authRepository.currentUserId
                    if (userId != null) {
                        when (val result = userRepository.getUser(userId)) {
                            is Resource.Success -> {
                                if (result.data.acceptedLegalVersion < CURRENT_LEGAL_VERSION) {
                                    navController.navigate(Screen.LegalAcceptance.route)
                                    return@LaunchedEffect
                                }
                            }
                            else -> {}
                        }
                    }
                    legalCheckDone = true
                }
            }

            // Save FCM token on login
            LaunchedEffect(Unit) {
                val userId = authRepository.currentUserId ?: return@LaunchedEffect
                try {
                    val token = FirebaseMessaging.getInstance().token.await()
                    notificationRepository.saveFcmToken(userId, token)
                } catch (_: Exception) {
                    // Token save failed — will retry on next app launch
                }
            }

            // Start PM sync service
            LaunchedEffect(Unit) {
                try {
                    val syncIntent = Intent(context, PmSyncService::class.java)
                    androidx.core.content.ContextCompat.startForegroundService(context, syncIntent)
                } catch (_: Exception) {
                    // Service start failed — non-critical
                }
            }

            LaunchedEffect(Unit) {
                if (!notificationPermissionRequested) {
                    notificationPermissionRequested = true
                    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.TIRAMISU) {
                        notificationPermissionLauncher.launch(Manifest.permission.POST_NOTIFICATIONS)
                    }
                    if (!Settings.canDrawOverlays(context)) {
                        showOverlayDialog = true
                    }
                }
            }

            if (showOverlayDialog) {
                AlertDialog(
                    onDismissRequest = { showOverlayDialog = false },
                    title = { Text("Display over other apps") },
                    text = { Text("Allow ShyTalk to show a floating bubble when you leave a voice room, so you can quickly return.") },
                    confirmButton = {
                        TextButton(onClick = {
                            showOverlayDialog = false
                            context.startActivity(
                                Intent(
                                    Settings.ACTION_MANAGE_OVERLAY_PERMISSION,
                                    Uri.parse("package:${context.packageName}")
                                )
                            )
                        }) {
                            Text("Allow")
                        }
                    },
                    dismissButton = {
                        TextButton(onClick = { showOverlayDialog = false }) {
                            Text("Not now")
                        }
                    }
                )
            }

            val conversationListViewModel: ConversationListViewModel = koinInject()
            val dailyRewardViewModel: DailyRewardViewModel = org.koin.compose.viewmodel.koinViewModel()
            var showDailyRewardDialog by rememberSaveable { mutableStateOf(true) }

            if (showDailyRewardDialog) {
                DailyRewardDialog(
                    viewModel = dailyRewardViewModel,
                    onDismiss = { showDailyRewardDialog = false }
                )
            }

            MainScreen(
                onNavigateToRoom = { roomId ->
                    navController.navigate(Screen.Room.createRoute(roomId))
                },
                onNavigateToUserProfile = { userId ->
                    navController.navigate(Screen.UserProfile.createRoute(userId))
                },
                onNavigateToFollowList = { userId, tab ->
                    navController.navigate(Screen.FollowList.createRoute(userId, tab))
                },
                onNavigateToSettings = {
                    navController.navigate(Screen.Settings.route)
                },
                onNavigateToLunarNewYear = {
                    navController.navigate(Screen.LunarNewYear.route)
                },
                onNavigateToNewMessage = {
                    navController.navigate(Screen.NewMessage.route)
                },
                onNavigateToWallet = {
                    navController.navigate(Screen.Wallet.route)
                },
                messagesContent = { modifier ->
                    ConversationListScreen(
                        onNavigateToChat = { otherUserId ->
                            navController.navigate(Screen.PrivateChat.createRoute(otherUserId))
                        },
                        onNavigateToGroupChat = { conversationId ->
                            navController.navigate(Screen.GroupChat.createRoute(conversationId))
                        },
                        modifier = modifier
                    )
                },
                totalUnreadCount = conversationListViewModel.uiState.collectAsState().value.totalUnreadCount,
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
                        modifier = modifier
                    )
                }
            )
        }

        composable(
            route = Screen.Room.route,
            arguments = listOf(navArgument("roomId") { type = NavType.StringType })
        ) { backStackEntry ->
            val roomId = backStackEntry.arguments?.getString("roomId") ?: return@composable
            RoomScreen(
                roomId = roomId,
                onNavigateBack = { navController.safePopBackStack() },
                onNavigateToUserProfile = { userId ->
                    navController.navigate(Screen.UserProfile.createRoute(userId))
                },
                onNavigateToChat = { otherUserId ->
                    navController.navigate(Screen.PrivateChat.createRoute(otherUserId))
                }
            )
        }

        composable(
            route = Screen.UserProfile.route,
            arguments = listOf(navArgument("userId") { type = NavType.StringType })
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
                }
            )
        }

        composable(
            route = Screen.PrivateChat.route,
            arguments = listOf(navArgument("otherUserId") { type = NavType.StringType })
        ) { backStackEntry ->
            val otherUserId = backStackEntry.arguments?.getString("otherUserId") ?: return@composable
            val context = LocalContext.current
            val chatViewModel: PrivateChatViewModel = org.koin.compose.viewmodel.koinViewModel(
                key = otherUserId
            ) { org.koin.core.parameter.parametersOf(otherUserId) }

            val imagePickerLauncher = rememberLauncherForActivityResult(
                ActivityResultContracts.PickMultipleVisualMedia(10)
            ) { uris ->
                if (uris.isNotEmpty()) {
                    val bytesList = uris.mapNotNull { uri ->
                        context.contentResolver.openInputStream(uri)?.readBytes()
                    }
                    chatViewModel.uploadAndSendImages(bytesList)
                }
            }

            val stickerPickerLauncher = rememberLauncherForActivityResult(
                ActivityResultContracts.PickVisualMedia()
            ) { uri ->
                if (uri != null) {
                    val bytes = context.contentResolver.openInputStream(uri)?.readBytes()
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
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                    )
                },
                onPickStickerImage = {
                    stickerPickerLauncher.launch(
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                    )
                },
                onNavigateToRoom = { roomId -> navigateToRoom(roomId) },
                activeRoomId = activeRoomId,
                activeRoomName = activeRoom?.name,
                viewModel = chatViewModel
            )
        }

        composable(
            route = Screen.FollowList.route,
            arguments = listOf(
                navArgument("userId") { type = NavType.StringType },
                navArgument("tab") { type = NavType.StringType }
            )
        ) { backStackEntry ->
            val userId = backStackEntry.arguments?.getString("userId") ?: return@composable
            val tab = backStackEntry.arguments?.getString("tab") ?: "followers"
            FollowListScreen(
                userId = userId,
                tab = tab,
                onNavigateBack = { navController.safePopBackStack() },
                onNavigateToUserProfile = { uid ->
                    navController.navigate(Screen.UserProfile.createRoute(uid))
                }
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
                onSignOut = {
                    // Remove FCM token before signing out
                    val signOutUserId = authRepository.currentUserId
                    if (signOutUserId != null) {
                        settingsScope.launch {
                            try {
                                val token = FirebaseMessaging.getInstance().token.await()
                                settingsNotificationRepo.removeFcmToken(signOutUserId, token)
                            } catch (_: Exception) {}
                        }
                    }
                    // Stop PM sync service
                    try {
                        val ctx = navController.context
                        ctx.stopService(Intent(ctx, PmSyncService::class.java))
                    } catch (_: Exception) {}
                    onSignOut()
                    navController.navigate(Screen.SignIn.route) {
                        popUpTo(Screen.Main.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.LunarNewYear.route) {
            LunarNewYearScreen(
                onNavigateBack = { navController.safePopBackStack() }
            )
        }

        composable(Screen.PrivacyPolicy.route) {
            PrivacyPolicyScreen(
                onAccept = { navController.safePopBackStack() },
                onDecline = { navController.safePopBackStack() },
                showActions = false
            )
        }

        composable(Screen.CommunityStandards.route) {
            CommunityStandardsScreen(
                onNavigateBack = { navController.safePopBackStack() }
            )
        }

        composable(Screen.TermsAndConditions.route) {
            TermsAndConditionsScreen(
                onNavigateBack = { navController.safePopBackStack() }
            )
        }

        composable(Screen.LegalAcceptance.route) {
            val legalUserRepository: UserRepository = koinInject()
            val legalScope = rememberCoroutineScope()

            LegalAcceptanceScreen(
                onAccept = {
                    legalScope.launch {
                        val userId = authRepository.currentUserId ?: return@launch
                        legalUserRepository.updateProfile(
                            userId,
                            mapOf("acceptedLegalVersion" to CURRENT_LEGAL_VERSION)
                        )
                        navController.safePopBackStack()
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
                }
            )
        }

        composable(Screen.ReportReview.route) {
            ReportReviewScreen(
                onNavigateBack = { navController.safePopBackStack() }
            )
        }

        composable(
            route = Screen.GroupChat.route,
            arguments = listOf(navArgument("conversationId") { type = NavType.StringType })
        ) { backStackEntry ->
            val cId = backStackEntry.arguments?.getString("conversationId") ?: return@composable
            val context = LocalContext.current
            val groupChatViewModel: PrivateChatViewModel = org.koin.compose.viewmodel.koinViewModel(
                key = cId
            ) { org.koin.core.parameter.parametersOf("", cId) }

            val groupImagePickerLauncher = rememberLauncherForActivityResult(
                ActivityResultContracts.PickMultipleVisualMedia(10)
            ) { uris ->
                if (uris.isNotEmpty()) {
                    val bytesList = uris.mapNotNull { uri ->
                        context.contentResolver.openInputStream(uri)?.readBytes()
                    }
                    groupChatViewModel.uploadAndSendImages(bytesList)
                }
            }

            val groupStickerPickerLauncher = rememberLauncherForActivityResult(
                ActivityResultContracts.PickVisualMedia()
            ) { uri ->
                if (uri != null) {
                    val bytes = context.contentResolver.openInputStream(uri)?.readBytes()
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
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                    )
                },
                onPickStickerImage = {
                    groupStickerPickerLauncher.launch(
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                    )
                },
                onNavigateToRoom = { roomId -> navigateToRoom(roomId) },
                activeRoomId = groupActiveRoomId,
                activeRoomName = groupActiveRoom?.name,
                viewModel = groupChatViewModel
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
                }
            )
        }

        composable(
            route = Screen.GroupSetup.route,
            arguments = listOf(navArgument("selectedIds") { type = NavType.StringType })
        ) { backStackEntry ->
            val selectedIds = backStackEntry.arguments?.getString("selectedIds") ?: return@composable
            val groupSetupContext = LocalContext.current
            val groupSetupViewModel: GroupSetupViewModel = org.koin.compose.viewmodel.koinViewModel(
                key = selectedIds
            ) { org.koin.core.parameter.parametersOf(selectedIds) }

            val groupPhotoCropLauncher = rememberLauncherForActivityResult(CropContract()) { uri ->
                if (uri != null) {
                    val bytes = try {
                        groupSetupContext.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    } catch (_: Exception) { null }
                    if (bytes != null) {
                        groupSetupViewModel.setGroupPhoto(bytes)
                    }
                }
            }

            val groupPhotoPickerLauncher = rememberLauncherForActivityResult(PickVisualMedia()) { uri ->
                if (uri != null) {
                    groupPhotoCropLauncher.launch(
                        CropInput(uri, 1, 1, "oval", 80, "Crop Group Photo")
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
                        PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)
                    )
                },
                viewModel = groupSetupViewModel
            )
        }

        composable(Screen.Wallet.route) {
            val walletViewModel: WalletViewModel = org.koin.compose.viewmodel.koinViewModel()
            val billingService: BillingService = koinInject()

            WalletScreen(
                viewModel = walletViewModel,
                onNavigateBack = { navController.safePopBackStack() },
                onNavigateToTransactions = { navController.navigate(Screen.Transactions.route) },
                onPurchasePackage = { pkg ->
                    // TODO: Launch billing flow for coin package
                },
                onPurchaseSubscription = { productId ->
                    // TODO: Launch billing flow for subscription
                }
            )
        }

        composable(Screen.Transactions.route) {
            val transactionHistoryViewModel: TransactionHistoryViewModel =
                org.koin.compose.viewmodel.koinViewModel()
            TransactionHistoryScreen(
                viewModel = transactionHistoryViewModel,
                onNavigateBack = { navController.safePopBackStack() }
            )
        }

        composable(
            route = Screen.GiftWall.route,
            arguments = listOf(navArgument("userId") { type = NavType.StringType })
        ) { backStackEntry ->
            val userId = backStackEntry.arguments?.getString("userId") ?: return@composable
            val giftWallViewModel: GiftWallViewModel = org.koin.compose.viewmodel.koinViewModel(
                key = userId
            ) { org.koin.core.parameter.parametersOf(userId) }

            GiftWallScreen(
                viewModel = giftWallViewModel,
                onNavigateBack = { navController.safePopBackStack() }
            )
        }

        composable(Screen.Warning.route) {
            val warningUserRepo: UserRepository = koinInject()
            val warningScope = rememberCoroutineScope()

            // Read the warning reason from user doc
            var warningReason by remember { mutableStateOf<String?>(null) }
            LaunchedEffect(Unit) {
                val userId = authRepository.currentUserId ?: return@LaunchedEffect
                val doc = FirebaseFirestore.getInstance()
                    .collection("users").document(userId).get().await()
                warningReason = doc.getString("warningReason")
            }

            WarningScreen(
                reason = warningReason,
                onAccept = {
                    warningScope.launch {
                        val userId = authRepository.currentUserId ?: return@launch
                        FirebaseFirestore.getInstance()
                            .collection("users").document(userId)
                            .update(
                                mapOf(
                                    "hasActiveWarning" to false,
                                    "warningAcceptedAt" to com.google.firebase.firestore.FieldValue.serverTimestamp()
                                )
                            ).await()
                        navController.navigate(Screen.Main.route) {
                            popUpTo(Screen.Warning.route) { inclusive = true }
                        }
                    }
                },
                onViewCommunityStandards = {
                    navController.navigate(Screen.CommunityStandards.route)
                }
            )
        }
    }
}
