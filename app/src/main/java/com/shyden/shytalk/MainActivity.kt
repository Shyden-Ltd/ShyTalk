package com.shyden.shytalk

import android.content.Intent
import android.net.Uri
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
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import com.shyden.shytalk.core.util.DeviceSecurityChecker
import com.shyden.shytalk.feature.security.UnsafeDeviceScreen
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
    private val _navigateToChat = mutableStateOf<Pair<String, Boolean>?>(null) // (id, isGroup)
    private val _showLeaveConfirmation = mutableStateOf(false)
    private var lastSeenJob: Job? = null

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()

        setContent {
            ShyTalkTheme(darkTheme = true) {
                var updateRequired by remember { mutableStateOf(false) }
                var checkComplete by remember { mutableStateOf(false) }
                var softUpdateAvailable by remember { mutableStateOf<String?>(null) }
                var isUnsafe by remember { mutableStateOf(false) }

                LaunchedEffect(Unit) {
                    isUnsafe = DeviceSecurityChecker.isUnsafe()
                    try {
                        val doc = FirebaseFirestore.getInstance()
                            .collection("config")
                            .document("app")
                            .get()
                            .await()
                        val minVersion = (doc.getLong("minVersionCode") ?: 0).toInt()
                        updateRequired = BuildConfig.VERSION_CODE < minVersion
                        if (!updateRequired) {
                            val latestVersion = (doc.getLong("latestVersionCode") ?: 0).toInt()
                            if (BuildConfig.VERSION_CODE < latestVersion) {
                                softUpdateAvailable = doc.getString("latestVersionName")
                                    ?: "v$latestVersion"
                            }
                        }
                    } catch (_: Exception) {
                        updateRequired = false
                    }
                    checkComplete = true
                }

                when {
                    !checkComplete -> { /* loading */ }
                    isUnsafe -> { UnsafeDeviceScreen() }
                    updateRequired -> { ForceUpdateScreen() }
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
                                onSignOut = { authRepository.signOut() }
                            )

                            if (softUpdateAvailable != null) {
                                AlertDialog(
                                    onDismissRequest = { softUpdateAvailable = null },
                                    title = { Text("Update Available") },
                                    text = { Text("A new version ($softUpdateAvailable) of ShyTalk is available.") },
                                    confirmButton = {
                                        TextButton(onClick = {
                                            softUpdateAvailable = null
                                            startActivity(
                                                Intent(
                                                    Intent.ACTION_VIEW,
                                                    Uri.parse("https://play.google.com/store/apps/details?id=com.shyden.shytalk")
                                                )
                                            )
                                        }) { Text("Update Now") }
                                    },
                                    dismissButton = {
                                        TextButton(onClick = { softUpdateAvailable = null }) {
                                            Text("Later")
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
