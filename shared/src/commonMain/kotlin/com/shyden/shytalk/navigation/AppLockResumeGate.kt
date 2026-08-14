package com.shyden.shytalk.navigation

import androidx.compose.runtime.Composable
import androidx.lifecycle.compose.LifecycleResumeEffect
import androidx.navigation.NavHostController
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.data.repository.AppLockRepository
import org.koin.compose.koinInject

private const val TAG = "AppLockResumeGate"

/**
 * Warm-resume App-Lock gate (SHY-0187), mounted once by BOTH nav graphs
 * (SharedNavGraph on iOS, the app NavGraph on Android).
 *
 * On every foreground resume it re-evaluates [shouldRelockOnResume]; when a
 * due lock exists over post-auth content it interposes [Screen.Lock] on top
 * of the current destination (the Lock screen pops back to that content on a
 * successful unlock, or routes to Sign-In via its reauth path). The decision
 * itself is pure and exhaustively unit-tested; this composable is only the
 * lifecycle + navigation shell.
 */
@Composable
fun AppLockResumeGate(navController: NavHostController) {
    val appLockRepository: AppLockRepository = koinInject()
    LifecycleResumeEffect(Unit) {
        val route = navController.currentDestination?.route
        if (
            shouldRelockOnResume(
                hasStoredCredential = appLockRepository.hasCredential,
                isAppLockEnabled = appLockRepository.isAppLockEnabled,
                isLockRequired = appLockRepository.isLockRequired(),
                currentRoute = route,
            )
        ) {
            logI(TAG, "Re-locking on resume (lock timeout expired; from route=$route)")
            navController.navigate(Screen.Lock.route) { launchSingleTop = true }
        }
        onPauseOrDispose {}
    }
}
