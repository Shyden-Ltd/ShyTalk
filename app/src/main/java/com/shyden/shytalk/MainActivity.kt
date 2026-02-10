package com.shyden.shytalk

import android.content.Intent
import android.content.res.Configuration
import android.os.Bundle
import androidx.activity.ComponentActivity
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import androidx.navigation.compose.rememberNavController
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.pip.PipContent
import com.shyden.shytalk.core.pip.PipHelper
import com.shyden.shytalk.core.room.ActiveRoomManager
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.feature.privacy.PrivacyPolicyScreen
import com.shyden.shytalk.feature.update.ForceUpdateScreen
import com.shyden.shytalk.navigation.NavGraph
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.NonCancellable
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import kotlinx.coroutines.withContext
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var authRepository: AuthRepository

    @Inject
    lateinit var activeRoomManager: ActiveRoomManager

    private val isInPipMode = mutableStateOf(false)
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
            ShyTalkTheme {
                var privacyAccepted by remember {
                    mutableStateOf(prefs.getBoolean(KEY_PRIVACY_ACCEPTED, false))
                }
                var updateRequired by remember { mutableStateOf(false) }
                var checkComplete by remember { mutableStateOf(false) }
                val inPip by isInPipMode

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
                    // PIP overlay
                    inPip -> {
                        val activeRoom by activeRoomManager.activeRoom.collectAsStateWithLifecycle()
                        PipContent(
                            roomName = activeRoom?.name ?: "Voice Room"
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
                                startDestination = Screen.GoogleSignIn.route,
                                activeRoomManager = activeRoomManager,
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

    override fun onNewIntent(intent: Intent) {
        super.onNewIntent(intent)
        handleRoomIntent(intent)
    }

    private fun handleRoomIntent(intent: Intent?) {
        if (intent?.action == "OPEN_ROOM") {
            val roomId = intent.getStringExtra("roomId")
            if (roomId != null) {
                _navigateToRoom.value = roomId
            }
        }
    }

    override fun onUserLeaveHint() {
        super.onUserLeaveHint()
        if (activeRoomManager.isInAnyRoom()) {
            PipHelper.enterPipMode(this)
        }
    }

    override fun onPictureInPictureModeChanged(
        isInPictureInPictureMode: Boolean,
        newConfig: Configuration
    ) {
        super.onPictureInPictureModeChanged(isInPictureInPictureMode, newConfig)
        isInPipMode.value = isInPictureInPictureMode

        if (!isInPictureInPictureMode) {
            if (isFinishing) {
                // PIP was swiped away — leave room cleanly
                CoroutineScope(Dispatchers.Main.immediate).launch {
                    withContext(NonCancellable) {
                        activeRoomManager.leaveRoom()
                    }
                }
            } else {
                // PIP tapped to expand — navigate to active room
                val roomId = activeRoomManager.activeRoomId.value
                if (roomId != null) {
                    _navigateToRoom.value = roomId
                }
            }
        }
    }
}
