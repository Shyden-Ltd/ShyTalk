package com.shyden.shytalk.util

import androidx.compose.ui.test.junit4.ComposeContentTestRule
import androidx.navigation.compose.rememberNavController
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import com.shyden.shytalk.navigation.NavGraph
import com.shyden.shytalk.navigation.Screen

fun ComposeContentTestRule.launchNavGraph(
    startDestination: String = Screen.Main.route,
    onSignOut: () -> Unit = {}
) {
    setContent {
        ShyTalkTheme {
            val navController = rememberNavController()
            NavGraph(
                navController = navController,
                startDestination = startDestination,
                onSignOut = onSignOut
            )
        }
    }
    // Give ViewModel init coroutines (viewModelScope.launch on Dispatchers.Main)
    // time to execute before the test starts asserting.
    Thread.sleep(300)
    // Disable auto-advance globally to prevent animation deadlocks.
    // Screens with CircularProgressIndicator have infinite animations that
    // cause waitForIdle() (called internally by assertExists, performClick,
    // etc.) to loop forever when autoAdvance is true.
    mainClock.autoAdvance = false
}

fun ComposeContentTestRule.launchMainScreen(
    onSignOut: () -> Unit = {}
) {
    launchNavGraph(startDestination = Screen.Main.route, onSignOut = onSignOut)
}

fun ComposeContentTestRule.launchSignIn(
    onSignOut: () -> Unit = {}
) {
    launchNavGraph(startDestination = Screen.SignIn.route, onSignOut = onSignOut)
}
