package com.shyden.shytalk

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.navigation.compose.rememberNavController
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.core.room.RoomService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.launch
import com.shyden.shytalk.feature.privacy.PrivacyPolicyScreen
import com.shyden.shytalk.feature.update.ForceUpdateScreen
import com.shyden.shytalk.navigation.NavGraph
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import kotlinx.coroutines.tasks.await
import org.koin.android.ext.android.inject

class MainActivity : ComponentActivity() {

    private val authRepository: AuthRepository by inject()
    private val userRepository: UserRepository by inject()
    private val activeRoomManager: RoomLifecycleManager by inject()

    private val _navigateToRoom = mutableStateOf<String?>(null)
    private val _navigateToProfile = mutableStateOf<String?>(null)
    private val _navigateToChat = mutableStateOf<Pair<String, Boolean>?>(null) // (id, isGroup)
    private val _showLeaveConfirmation = mutableStateOf(false)

    companion object {
        private const val PREFS_NAME = "shytalk_prefs"
        private const val KEY_PRIVACY_ACCEPTED = "privacy_policy_accepted"
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        val prefs = getSharedPreferences(PREFS_NAME, MODE_PRIVATE)

        setContent {
            ShyTalkTheme(darkTheme = true) {
                var privacyAccepted by remember {
                    mutableStateOf(prefs.getBoolean(KEY_PRIVACY_ACCEPTED, false))
                }
                var updateRequired by remember { mutableStateOf(false) }
                var checkComplete by remember { mutableStateOf(false) }

                LaunchedEffect(Unit) {
                    try {
                        val doc = FirebaseFirestore.getInstance()
                            .collection("config")
                            .document("app")
                            .get()
                            .await()
                        val minVersion = (doc.getLong("minVersionCode") ?: 0).toInt()
                        updateRequired = BuildConfig.VERSION_CODE < minVersion
                    } catch (_: Exception) {
                        updateRequired = false
                    }
                    checkComplete = true
                }

                when {
                    // Privacy policy must be accepted first
                    !privacyAccepted -> {
                        PrivacyPolicyScreen(
                            onAccept = {
                                prefs.edit().putBoolean(KEY_PRIVACY_ACCEPTED, true).apply()
                                privacyAccepted = true
                            },
                            onDecline = {
                                finishAffinity()
                            }
                        )
                    }
                    // Normal app flow
                    checkComplete -> {
                        if (updateRequired) {
                            ForceUpdateScreen()
                        } else {
                            val navController = rememberNavController()
                            val navigateToRoomId by _navigateToRoom

                            val navigateToProfileId by _navigateToProfile

                            LaunchedEffect(navigateToRoomId) {
                                val roomId = navigateToRoomId
                                if (roomId != null) {
                                    navController.navigate(Screen.Room.createRoute(roomId)) {
                                        launchSingleTop = true
                                    }
                                    _navigateToRoom.value = null
                                }
                            }

                            LaunchedEffect(navigateToProfileId) {
                                val profileId = navigateToProfileId
                                if (profileId != null) {
                                    navController.navigate(Screen.UserProfile.createRoute(profileId)) {
                                        launchSingleTop = true
                                    }
                                    _navigateToProfile.value = null
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
                                onSignOut = { authRepository.signOut() }
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
                        title = { Text(if (isOwner) "Close Room?" else "Leave Room?") },
                        text = { Text(
                            if (isOwner) "This will close the room for everyone."
                            else "You will leave the voice room."
                        ) },
                        confirmButton = {
                            TextButton(onClick = {
                                _showLeaveConfirmation.value = false
                                val intent = Intent(this@MainActivity, RoomService::class.java).apply {
                                    action = "CONFIRM_DISMISS"
                                }
                                startService(intent)
                            }) { Text("Leave") }
                        },
                        dismissButton = {
                            TextButton(onClick = { _showLeaveConfirmation.value = false }) {
                                Text("Cancel")
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
        authRepository.currentUserId?.let { uid ->
            CoroutineScope(Dispatchers.IO).launch { userRepository.updateLastSeen(uid) }
        }
    }

    override fun onStop() {
        super.onStop()
        activeRoomManager.isAppInForeground = false
    }

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleRoomIntent(intent)
    }

    private fun handleRoomIntent(intent: Intent?) {
        // Handle deep links (https://shytalk.shyden.co.uk/profile/{userId})
        val data = intent?.data
        if (data != null && data.host == "shytalk.shyden.co.uk") {
            val pathSegments = data.pathSegments
            if (pathSegments.size >= 2 && pathSegments[0] == "profile") {
                _navigateToProfile.value = pathSegments[1]
                return
            }
        }

        // Handle PM notification tap (navigateTo=chat)
        val navigateTo = intent?.getStringExtra("navigateTo")
        if (navigateTo == "chat") {
            val isGroup = intent.getBooleanExtra("isGroup", false)
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
            return
        }

        when (intent?.action) {
            "OPEN_ROOM" -> {
                val roomId = intent.getStringExtra("roomId")
                if (roomId != null) {
                    _navigateToRoom.value = roomId
                }
            }
            "CONFIRM_LEAVE_ROOM" -> {
                _showLeaveConfirmation.value = true
            }
            "FINISH_APP" -> {
                finishAffinity()
            }
        }
    }
}
