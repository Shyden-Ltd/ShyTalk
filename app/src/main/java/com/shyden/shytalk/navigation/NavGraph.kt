package com.shyden.shytalk.navigation

import android.Manifest
import android.content.Intent
import android.net.Uri
import android.os.Build
import android.provider.Settings
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.room.ActiveRoomManager
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.feature.auth.GoogleSignInScreen
import com.shyden.shytalk.feature.home.LunarNewYearScreen
import com.shyden.shytalk.feature.main.MainScreen
import com.shyden.shytalk.feature.privacy.PrivacyPolicyScreen
import com.shyden.shytalk.feature.settings.AppSettingsScreen
import com.shyden.shytalk.feature.profile.FollowListScreen
import com.shyden.shytalk.feature.profile.ProfileScreen
import com.shyden.shytalk.feature.profile.ProfileSetupScreen
import com.shyden.shytalk.feature.profile.RequiredDOBScreen
import com.shyden.shytalk.feature.room.RoomScreen
import org.koin.compose.koinInject

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

    // Real-time suspension listener: force sign-out when user is actively suspended
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
            var notificationPermissionRequested by rememberSaveable { mutableStateOf(false) }
            var showOverlayDialog by rememberSaveable { mutableStateOf(false) }

            val notificationPermissionLauncher = rememberLauncherForActivityResult(
                ActivityResultContracts.RequestPermission()
            ) { /* granted or denied — no action needed */ }

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
                onNavigateBack = { navController.popBackStack() },
                onNavigateToUserProfile = { userId ->
                    navController.navigate(Screen.UserProfile.createRoute(userId))
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
                onNavigateBack = { navController.popBackStack() },
                onNavigateToUserProfile = { uid ->
                    navController.navigate(Screen.UserProfile.createRoute(uid))
                },
                onNavigateToFollowList = { uid, tab ->
                    navController.navigate(Screen.FollowList.createRoute(uid, tab))
                },
                onNavigateToRoom = { roomId -> navigateToRoom(roomId) }
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
                onNavigateBack = { navController.popBackStack() },
                onNavigateToUserProfile = { uid ->
                    navController.navigate(Screen.UserProfile.createRoute(uid))
                }
            )
        }

        composable(Screen.Settings.route) {
            AppSettingsScreen(
                onNavigateBack = { navController.popBackStack() },
                onNavigateToPrivacyPolicy = {
                    navController.navigate(Screen.PrivacyPolicy.route)
                },
                onSignOut = {
                    onSignOut()
                    navController.navigate(Screen.SignIn.route) {
                        popUpTo(Screen.Main.route) { inclusive = true }
                    }
                }
            )
        }

        composable(Screen.LunarNewYear.route) {
            LunarNewYearScreen(
                onNavigateBack = { navController.popBackStack() }
            )
        }

        composable(Screen.PrivacyPolicy.route) {
            PrivacyPolicyScreen(
                onAccept = { navController.popBackStack() },
                onDecline = { navController.popBackStack() },
                showActions = false
            )
        }
    }
}
