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
 *  - Every deep-link navigate() call site checks the lock gate first.
 *
 * Known limitation: these are raw substring pins, not AST-aware — a
 * COMMENTED-OUT wiring line keeps them green. They catch deletion (the
 * realistic regression: a refactor drops the call), not sabotage; the
 * behavioural layers (commonTest decisions + the device gauntlet) are the
 * semantic backstop.
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
    fun `every deep-link navigation call site checks the lock gate first`() {
        // MainActivity has THREE gated intent paths (room + chat + in-room PM);
        // the iOS collector one. The in-room PM path (R2 Critical) is the
        // handleRoomIntent branch that used to call requestOpenPm directly —
        // synchronously, before ON_RESUME could interpose the Lock.
        val android = read(mainActivity)
        val androidGates = Regex("isNavigationLockGated\\(").findAll(android).count()
        assertTrue(
            androidGates >= 3,
            "$mainActivity must gate ALL THREE deep-link paths (room + chat + in-room PM); " +
                "found $androidGates call(s) — an ungated path lands content on top of the Lock screen",
        )
        val ios = read(mainViewController)
        assertTrue(
            ios.contains("isNavigationLockGated("),
            "$mainViewController must gate the chat deep-link collector",
        )
    }

    @Test
    fun `in-room PM intents route through a pending state not a direct open call`() {
        // R2 Critical: handleRoomIntent runs synchronously in onCreate/onNewIntent
        // where no navController exists, so it must PUBLISH the intent into a
        // state the composition consumes behind the lock gate — never call
        // requestOpenPm directly (that raced the ON_RESUME re-lock and skipped
        // the push-authz re-check entirely).
        val android = read(mainActivity)
        assertTrue(
            android.contains("pendingInRoomPmState"),
            "$mainActivity must publish in-room PM intents into pendingInRoomPmState " +
                "for the gated LaunchedEffect to consume",
        )
    }

    @Test
    fun `both android chat-content paths re-verify push authorization`() {
        // The chat deep-link effect AND the in-room PM effect must each call
        // verifyPushNavigation (block-list + group-membership re-check,
        // fail-closed) — a compromised push payload must not open content
        // through EITHER path.
        val android = read(mainActivity)
        val authzChecks = Regex("verifyPushNavigation\\(").findAll(android).count()
        assertTrue(
            authzChecks >= 2,
            "$mainActivity must re-verify push authz on both chat-content paths " +
                "(chat navigate + in-room PM); found $authzChecks call(s)",
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

    // ── Enrolment surface (found during the SHY-0187 device gauntlet) ──────
    // The lock wiring above is unreachable for a real user if the enrolment
    // surface stays dark: SecuritySettingsScreen (the ONLY setAppLockEnabled
    // caller) and PinSetupScreen (the ONLY setCredential caller) had zero
    // navigation consumers, so no user could ever turn the App-Lock on. Same
    // defect class as the lock itself — one pin per enrolment wiring point.

    private val appSettingsScreen = "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/settings/AppSettingsScreen.kt"
    private val securitySettingsScreen =
        "shared/src/commonMain/kotlin/com/shyden/shytalk/feature/settings/SecuritySettingsScreen.kt"
    private val iosPlatformScreens = "shared/src/iosMain/kotlin/com/shyden/shytalk/navigation/IosPlatformScreens.kt"

    @Test
    fun `settings main page offers a security entry`() {
        val src = read(appSettingsScreen)
        assertTrue(
            src.contains("onNavigateToSecurity"),
            "$appSettingsScreen must expose an onNavigateToSecurity callback — without a Settings " +
                "entry the App-Lock enrolment screen is unreachable and the lock can never be enabled",
        )
        assertTrue(
            src.contains("settings_securityItem"),
            "$appSettingsScreen must render the Security row (testTag settings_securityItem)",
        )
    }

    @Test
    fun `both nav graphs register the SecuritySettings destination`() {
        listOf(sharedNavGraph, appNavGraph).forEach { path ->
            val src = read(path)
            assertTrue(
                src.contains("composable(Screen.SecuritySettings.route)"),
                "$path must register Screen.SecuritySettings — it is the ONLY caller of " +
                    "setAppLockEnabled, so an unregistered screen means the lock can never be turned on",
            )
            assertTrue(
                src.contains("onNavigateToSecurity = { navController.navigate(Screen.SecuritySettings.route) }"),
                "$path must route the Settings security entry to Screen.SecuritySettings",
            )
        }
    }

    @Test
    fun `both nav graphs register the PinSetup destination and route reset-pin to it`() {
        listOf(sharedNavGraph, appNavGraph).forEach { path ->
            val src = read(path)
            assertTrue(
                src.contains("composable(Screen.PinSetup.route)"),
                "$path must register Screen.PinSetup — it is the ONLY caller of setCredential, " +
                    "so an unregistered screen means no credential can ever be stored",
            )
            assertTrue(
                src.contains("onResetPin = { navController.navigate(Screen.PinSetup.route) }"),
                "$path must route the Security screen's reset-PIN action to Screen.PinSetup",
            )
        }
    }

    @Test
    fun `ios platform screens thread the security navigation through to the shared settings screen`() {
        val src = read(iosPlatformScreens)
        assertTrue(
            src.contains("onNavigateToSecurity"),
            "$iosPlatformScreens must thread AppSettingsScreenParams.onNavigateToSecurity into " +
                "AppSettingsScreen — otherwise the Security row is dead on iOS only",
        )
    }

    @Test
    fun `security settings carries no dead linked-accounts row`() {
        // Linked accounts live INSIDE AppSettingsScreen as an internal page;
        // SecuritySettingsScreen's onLinkedAccounts callback had no reachable
        // destination (no Screen route exists). A visible row that does
        // nothing is a shipped placeholder — it must stay removed until a
        // real destination exists (a future story re-adds row + route + pin
        // together).
        val src = read(securitySettingsScreen)
        assertFalse(
            src.contains("onLinkedAccounts"),
            "$securitySettingsScreen must not render a linked-accounts row with no destination — " +
                "AppSettingsScreen's internal LinkedAccounts page is the real surface",
        )
    }
}
