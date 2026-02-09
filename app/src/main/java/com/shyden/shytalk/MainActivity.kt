package com.shyden.shytalk

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
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.feature.update.ForceUpdateScreen
import com.shyden.shytalk.navigation.NavGraph
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import dagger.hilt.android.AndroidEntryPoint
import kotlinx.coroutines.tasks.await
import javax.inject.Inject

@AndroidEntryPoint
class MainActivity : ComponentActivity() {

    @Inject
    lateinit var authRepository: AuthRepository

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        enableEdgeToEdge()
        setContent {
            ShyTalkTheme {
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
                        // If check fails, allow the user through
                        updateRequired = false
                    }
                    checkComplete = true
                }

                if (checkComplete) {
                    if (updateRequired) {
                        ForceUpdateScreen()
                    } else {
                        val navController = rememberNavController()
                        NavGraph(
                            navController = navController,
                            startDestination = Screen.GoogleSignIn.route,
                            onSignOut = { authRepository.signOut() }
                        )
                    }
                }
            }
        }
    }
}
