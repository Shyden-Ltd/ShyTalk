package com.shyden.shytalk

import android.content.Intent
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.navigation.compose.rememberNavController
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.room.ActiveRoomManager
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
    private val activeRoomManager: ActiveRoomManager by inject()

    private val _navigateToRoom = mutableStateOf<String?>(null)

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

                            LaunchedEffect(navigateToRoomId) {
                                val roomId = navigateToRoomId
                                if (roomId != null) {
                                    navController.navigate(Screen.Room.createRoute(roomId)) {
                                        launchSingleTop = true
                                    }
                                    _navigateToRoom.value = null
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
        when (intent?.action) {
            "OPEN_ROOM" -> {
                val roomId = intent.getStringExtra("roomId")
                if (roomId != null) {
                    _navigateToRoom.value = roomId
                }
            }
            "FINISH_APP" -> {
                finishAffinity()
            }
        }
    }
}
