package com.shyden.shytalk.navigation

import java.io.File
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Source pin for the SHY-0187 App-Lock navigation wiring.
 *
 * The decision layer is unit-covered (LaunchDestinationTest), but the bug
 * this story fixes was never a logic bug — LockScreen + LockScreenViewModel
 * existed, DI-bound and tested, while NOTHING in navigation consumed them:
 * `Screen.Lock` had zero registrations and `needsLockScreen` zero readers,
 * so the lock never rendered. A pure-logic suite stays green through that
 * regression, which is why this pin reads the real navigation sources on
 * the host JVM and fails if any consumption point disappears again.
 *
 * One pin per wiring point, so a regression names its exact location:
 *  - Android cold launch (MainActivity) resolves via the shared resolver.
 *  - iOS cold launch (MainViewController) resolves via the shared resolver
 *    and no longer hardcodes Sign-In.
 *  - BOTH nav graphs (SharedNavGraph for iOS, the app NavGraph for Android)
 *    register the Lock destination and mount the warm-resume re-lock gate.
 *  - The Lock screen consumes the system back gesture (no back-bypass).
 */
class AppLockWiringPinTest {
    private fun repoRoot(): File {
        var dir: File? = File(System.getProperty("user.dir"))
        while (dir != null) {
            if (File(dir, "settings.gradle.kts").exists()) return dir
            dir = dir.parentFile
        }
        error("repo root (settings.gradle.kts) not found from ${System.getProperty("user.dir")}")
    }

    private fun read(relative: String): String {
        val f = File(repoRoot(), relative)
        assertTrue(f.exists(), "expected source file to exist: $relative")
        return f.readText()
    }

    private val mainActivity = "app/src/main/java/com/shyden/shytalk/MainActivity.kt"
    private val mainViewController = "shared/src/iosMain/kotlin/com/shyden/shytalk/MainViewController.kt"
    private val sharedNavGraph = "shared/src/commonMain/kotlin/com/shyden/shytalk/navigation/SharedNavGraph.kt"
    private val appNavGraph = "app/src/main/java/com/shyden/shytalk/navigation/NavGraph.kt"
    private val lockScreen = "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/auth/LockScreen.kt"

    @Test
    fun `android cold launch resolves its initial route through the shared resolver`() {
        val src = read(mainActivity)
        assertTrue(
            src.contains("resolveLaunchDestination("),
            "$mainActivity must consume resolveLaunchDestination for its initial route " +
                "(SHY-0187: the pre-fix code skipped the App-Lock entirely on cold launch)",
        )
    }

    @Test
    fun `ios cold launch resolves its start destination through the shared resolver`() {
        val src = read(mainViewController)
        assertTrue(
            src.contains("resolveLaunchDestination("),
            "$mainViewController must consume resolveLaunchDestination for its start destination",
        )
        assertFalse(
            src.contains("startDestination = Screen.SignIn.route"),
            "$mainViewController must not hardcode Sign-In as the start destination " +
                "(the SHY-0187 pre-fix platform asymmetry)",
        )
    }

    @Test
    fun `shared nav graph registers the Lock destination and mounts the resume gate`() {
        val src = read(sharedNavGraph)
        assertTrue(
            src.contains("composable(Screen.Lock.route)"),
            "$sharedNavGraph must register Screen.Lock (pre-fix: zero registrations, the lock never rendered)",
        )
        assertTrue(
            src.contains("AppLockResumeGate("),
            "$sharedNavGraph must mount AppLockResumeGate so a background-timeout re-locks on resume",
        )
    }

    @Test
    fun `android nav graph registers the Lock destination and mounts the resume gate`() {
        val src = read(appNavGraph)
        assertTrue(
            src.contains("composable(Screen.Lock.route)"),
            "$appNavGraph must register Screen.Lock (Android uses its own graph, not SharedNavGraph — " +
                "wiring only the shared graph would fix iOS and leave the Android bug live)",
        )
        assertTrue(
            src.contains("AppLockResumeGate("),
            "$appNavGraph must mount AppLockResumeGate so a background-timeout re-locks on resume",
        )
    }

    @Test
    fun `ios records the background timestamp the lock timeout is measured from`() {
        // Only Android's MainActivity onStop wrote KEY_LAST_ACTIVE before this
        // story. Without an iOS writer, the timestamp stays at the last
        // setCredential — so after one unlock the resume gate re-locks on EVERY
        // resume (elapsed is measured from an ancient write). The Swift side
        // must observe didEnterBackground and call the Kotlin bridge.
        val koinHelper = read("shared/src/iosMain/kotlin/com/shyden/shytalk/core/di/KoinHelper.kt")
        assertTrue(
            koinHelper.contains("fun recordAppBackgroundedForAppLock("),
            "KoinHelper.kt must export the Swift-callable background-timestamp bridge",
        )
        val appDelegate = read("iosApp/iosApp/AppDelegate.swift")
        assertTrue(
            appDelegate.contains("didEnterBackgroundNotification"),
            "AppDelegate.swift must observe didEnterBackground to record the lock timestamp",
        )
        assertTrue(
            appDelegate.contains("recordAppBackgroundedForAppLock"),
            "AppDelegate.swift must call the Kotlin bridge on backgrounding",
        )
    }

    @Test
    fun `lock screen consumes the system back gesture`() {
        val src = read(lockScreen)
        assertTrue(
            src.contains("PlatformBackHandler("),
            "$lockScreen must consume back — otherwise the back gesture reveals the content beneath the lock",
        )
    }
}
