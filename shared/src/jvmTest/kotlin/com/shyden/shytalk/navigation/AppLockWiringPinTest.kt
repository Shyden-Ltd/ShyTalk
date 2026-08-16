package com.shyden.shytalk.navigation

import java.io.File
import kotlin.test.Test
import kotlin.test.assertEquals
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

    // SHY-0143 moved both platforms from `resolveLaunchDestination` to
    // `resolveColdStartDestination`, which wraps it with the pre-routing ban
    // gate. The invariant these pins protect is unchanged and is NOT the name
    // of the function: it is that cold launch resolves through the SHARED
    // resolver, so the two platforms cannot drift apart (SHY-0187's whole
    // point — the pre-fix iOS code hardcoded Sign-In and skipped the App-Lock).
    // The pins follow the invariant to its new home, and the third test below
    // makes them stricter than before by requiring both platforms to use the
    // SAME resolver rather than merely each using some shared one.
    private val coldStartResolver = "resolveColdStartDestination("

    // SHY-0143 R2 moved BOTH platforms again, from calling the resolver inline
    // to running `ColdStartSequencer`, which calls it. The invariant is still
    // not the name of anything — it is that ONE shared object decides the
    // cold-start destination for both platforms — so the pins follow it to its
    // new home and additionally verify the chain: platform → sequencer →
    // resolver. Pinning only "the platform mentions the sequencer" would pass
    // if the sequencer stopped consulting the resolver.
    private val coldStartSequencer = "ColdStartSequencer("
    private val androidAuthRepo = "app/src/main/java/com/shyden/shytalk/data/repository/AuthRepositoryImpl.kt"
    private val iosAuthRepo =
        "shared/src/iosMain/kotlin/com/shyden/shytalk/data/repository/IosAuthRepositoryImpl.kt"
    private val sequencerSource = "shared/src/commonMain/kotlin/com/shyden/shytalk/navigation/ColdStartSequencer.kt"

    @Test
    fun `android cold launch resolves its initial route through the shared resolver`() {
        val src = read(mainActivity)
        assertTrue(
            src.contains(coldStartSequencer),
            "$mainActivity must run $coldStartSequencer for its initial route " +
                "(SHY-0187: the pre-fix code skipped the App-Lock entirely on cold launch; " +
                "SHY-0143: the sequence now also carries the ban gate and the cohort gate)",
        )
        assertTrue(
            read(sequencerSource).contains(coldStartResolver),
            "$sequencerSource must consume $coldStartResolver — the platforms delegate " +
                "their routing decision to it, so a sequencer that stopped calling the " +
                "resolver would silently restore the SHY-0187 asymmetry",
        )
    }

    @Test
    fun `both platforms resolve cold launch through the SAME shared function`() {
        // The asymmetry SHY-0187 killed was iOS deciding differently from
        // Android. Asserting each side uses "a" shared resolver would let them
        // drift onto two different ones; this asserts they use one.
        val android = read(mainActivity)
        val ios = read(mainViewController)
        assertTrue(
            android.contains(coldStartSequencer) && ios.contains(coldStartSequencer),
            "both $mainActivity and $mainViewController must run $coldStartSequencer — " +
                "one sequence, one object, or the platforms drift again",
        )
        // And neither may keep a second, bypassing route computation.
        assertTrue(
            !android.contains("resolveLaunchDestination(") && !ios.contains("resolveLaunchDestination("),
            "neither platform may call resolveLaunchDestination directly — that path " +
                "skips the SHY-0143 ban gate, which is exactly how the optimistic " +
                "cold start shipped without it",
        )
    }

    @Test
    fun `ios cold launch resolves its start destination through the shared resolver`() {
        val src = read(mainViewController)
        assertTrue(
            src.contains(coldStartSequencer),
            "$mainViewController must run $coldStartSequencer for its start destination",
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
    fun `reset-PIN is identity-gated when a credential already exists`() {
        // SECURITY (device-gauntlet finding): the reset-PIN row's copy promises
        // "Verify your identity to set a new PIN", but wiring onResetPin straight
        // into PinSetup let anyone with the unlocked phone (the App-Lock's exact
        // threat model — Settings is only reachable unlocked) silently replace
        // the PIN with no re-auth. The screen must show PinVerifyDialog before
        // resetting WHEN a credential exists; a first-time set (no credential)
        // has nothing to verify and passes through.
        val src = read(securitySettingsScreen)
        assertTrue(
            src.contains("PinVerifyDialog("),
            "$securitySettingsScreen must gate reset-PIN behind PinVerifyDialog — the copy promises " +
                "identity verification and the App-Lock is defeated if a PIN can be reset without it",
        )
        assertTrue(
            src.contains("hasCredential"),
            "$securitySettingsScreen must branch on appLockRepository.hasCredential so first-time PIN " +
                "setup (no existing credential) is not locked out by the verification gate",
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

    // ── SHY-0143: the cold-start identity must be REAL before routing ─────
    //
    // `hasResolvedUser` is the resolver's "we know who this is" input, and both
    // platforms were feeding it `currentUserId != null`. That is not the same
    // question: `currentUserId` is `resolvedUniqueId ?: firebaseUid`, so it goes
    // non-null the instant Firebase restores a session, long before any identity
    // is resolved. The resolver therefore chose Main for a session whose uniqueId
    // was still unknown, and every read behind it addressed `users/<firebaseUid>`
    // — the SHY-0139 wrong-key hazard.
    //
    // Two things have to hold together, which is why they are pinned together:
    // the predicate must ask the honest question, AND something must have put a
    // real answer in place first. Either alone is a regression — an honest
    // predicate with no hydration sends every returning user to the Lock screen;
    // hydration with a dishonest predicate leaves the hazard exactly as it was.

    private val androidKoinModule = "app/src/main/java/com/shyden/shytalk/core/di/AppKoinModule.kt"
    private val iosKoinModule = "shared/src/iosMain/kotlin/com/shyden/shytalk/core/di/IosPlatformModule.kt"

    @Test
    fun `neither platform passes currentUserId as hasResolvedUser`() {
        listOf(mainActivity, mainViewController).forEach { path ->
            val src = read(path)
            assertFalse(
                src.contains("hasResolvedUser = authRepository.currentUserId != null") ||
                    src.contains("hasResolvedUser = authRepo.currentUserId != null"),
                "$path must not answer hasResolvedUser with currentUserId — it falls back to the " +
                    "raw Firebase UID, so it reports a resolved user before one exists",
            )
        }
    }

    @Test
    fun `both platforms answer hasResolvedUser with the resolved uniqueId`() {
        // The positive half. Pinning only the absence above would be satisfied by
        // deleting the argument, or by inventing a third, equally dishonest one.
        listOf(mainActivity, mainViewController).forEach { path ->
            val src = read(path)
            assertTrue(
                src.contains("hasResolvedUser = authRepository.resolvedUniqueId != null") ||
                    src.contains("hasResolvedUser = authRepo.resolvedUniqueId != null"),
                "$path must answer hasResolvedUser with resolvedUniqueId — the only field that " +
                    "is non-null solely because identity resolution actually happened",
            )
        }
    }

    @Test
    fun `every hasResolvedUser argument on both platforms uses the honest field`() {
        // Whole-unit, not first-match: MainActivity passes hasResolvedUser at
        // four call sites (three deep-link lock gates plus the cold-start
        // resolver). Fixing one and leaving three is the realistic regression,
        // and a `contains` pin cannot see it.
        listOf(mainActivity, mainViewController).forEach { path ->
            val occurrences =
                read(path)
                    .lineSequence()
                    .filter { it.contains("hasResolvedUser =") }
                    .map { it.trim() }
                    .toList()
            assertTrue(occurrences.isNotEmpty(), "$path should pass hasResolvedUser somewhere")
            val dishonest = occurrences.filter { it.contains("currentUserId") }
            assertTrue(
                dishonest.isEmpty(),
                "$path has ${dishonest.size} of ${occurrences.size} hasResolvedUser arguments still " +
                    "keyed on currentUserId: $dishonest",
            )
        }
    }

    @Test
    fun `both platforms hydrate the cached identity before routing`() {
        listOf(mainActivity, mainViewController).forEach { path ->
            val src = read(path)
            assertTrue(
                src.contains("sessionCache.read("),
                "$path must read the SessionCache before it resolves a destination — without it " +
                    "the honest hasResolvedUser predicate sends every returning user to the Lock screen",
            )
            assertTrue(
                src.contains("resolvedUniqueId = "),
                "$path must publish the cached uniqueId onto AuthRepository — reading it and " +
                    "discarding it leaves every downstream read keyed on the Firebase UID",
            )
        }
    }

    @Test
    fun `both platforms wire the cohort gate into the cold-start sequence`() {
        // The gap this catches was live: `ColdStartSequencer` existed, was
        // covered by nine ordering tests, and was constructed by NOTHING. Its
        // GATE 2 — refresh the token before any cohort-scoped read — therefore
        // ran only on the sign-in path, which the optimistic cold start skips.
        // A restored session rendered its room list on LAST session's cohort
        // claim: the SHY-0132/0137 cross-cohort leak.
        //
        // Nine green tests over an object production never calls read exactly
        // like coverage, which is why this pin asserts CONSTRUCTION and not
        // merely the class's existence.
        listOf(mainActivity, mainViewController).forEach { path ->
            val src = read(path)
            assertTrue(
                src.contains(coldStartSequencer),
                "$path must construct $coldStartSequencer — a sequencer nobody builds gates nothing",
            )
            assertTrue(
                src.contains("refreshToken = "),
                "$path must supply the sequencer's refreshToken gate; omitting it is how the " +
                    "cohort claim goes stale on a restored session",
            )
            assertTrue(
                src.contains("refreshIdToken()") || src.contains("forceRefreshToken()"),
                "$path's refreshToken gate must actually force a token refresh, not return a " +
                    "constant — the point is re-reading the custom claims",
            )
            assertTrue(
                src.contains("checkBans = "),
                "$path must supply the sequencer's ban gate",
            )
        }
    }

    @Test
    fun `the sequencer refuses to start cohort-scoped reads before the refresh`() {
        // Guards the sequencer's own body, since both platforms now delegate
        // the ordering to it entirely. If `startCohortScopedReads` were hoisted
        // above the refresh, every platform would leak at once and the pins
        // above would all still pass.
        val src = read(sequencerSource)
        val refreshAt = src.indexOf("if (refreshToken())")
        val verifiedAt = src.indexOf("cohortVerified = true")
        val readsAt = src.indexOf("startCohortScopedReads()")
        assertTrue(refreshAt >= 0, "$sequencerSource must gate on refreshToken()")
        assertTrue(readsAt >= 0, "$sequencerSource must start cohort-scoped reads somewhere")
        assertTrue(
            refreshAt < readsAt,
            "$sequencerSource must refresh the token BEFORE starting cohort-scoped reads " +
                "(refresh at $refreshAt, reads at $readsAt)",
        )
        // Stronger than ordering alone: the reads must live INSIDE the
        // successful-refresh branch, marked by `cohortVerified = true`. Mere
        // ordering would still pass if the call were moved below the whole
        // if/else and ran on the offline path too.
        assertTrue(
            verifiedAt in (refreshAt + 1) until readsAt,
            "$sequencerSource must set cohortVerified inside the successful-refresh branch, " +
                "immediately before the reads it authorises",
        )
        assertEquals(
            1,
            Regex(Regex.escape("startCohortScopedReads()")).findAll(src).count(),
            "$sequencerSource must start cohort-scoped reads from exactly ONE place — a second " +
                "call site is how the unverified path would quietly regain them",
        )
    }

    @Test
    fun `both nav graphs key the user-flag subscription on the RESOLVED uniqueId`() {
        // The listener used to key on `currentUserId`, which is
        // `resolvedUniqueId ?: firebaseUid` — so on a cache miss it watched
        // `users/<firebaseUid>`, a document that does not exist (SHY-0139).
        //
        // An earlier attempt gated it on a `cohortVerified` snapshot instead.
        // That was both the wrong property (reading one's OWN user doc is not
        // a cross-cohort read) and a one-shot value: the sequencer runs once
        // per process and returns early for Lock and Sign-In, so after a PIN
        // unlock or a normal sign-in the flag stayed false and this — the only
        // real-time suspension and warning listener in the app — never
        // subscribed. SHY-0024's AC pins that it must keep working.
        listOf(sharedNavGraph, appNavGraph).forEach { path ->
            val src = read(path)
            assertTrue(
                src.contains("mutableStateOf(authRepository.resolvedUniqueId)"),
                "$path must seed its user id from resolvedUniqueId, not the firebaseUid fallback",
            )
            assertTrue(
                src.contains("currentUserId = authRepository.resolvedUniqueId"),
                "$path must RE-SYNC from resolvedUniqueId too — the re-sync is what picks the id " +
                    "up after a PIN unlock or a sign-in, neither of which re-runs the sequencer",
            )
            assertFalse(
                src.contains("mutableStateOf(authRepository.currentUserId)"),
                "$path must not fall back to the Firebase UID for a user-scoped read",
            )
        }
    }

    @Test
    fun `both platforms let the sequencer tell a revoked session from an offline one`() {
        // `firebaseCall` maps every exception to Resource.Error, so without a
        // second signal an offline launch is indistinguishable from a revoked
        // token — and the sequencer signs out on the latter. Rotating the phone
        // in airplane mode re-runs the whole sequence, so that was a logout.
        listOf(mainActivity, mainViewController).forEach { path ->
            assertTrue(
                read(path).contains("isSessionAlive = "),
                "$path must supply isSessionAlive, or a transport failure is treated as a revocation",
            )
        }
        val src = read(sequencerSource)
        val refreshAt = src.indexOf("if (refreshToken())")
        val aliveAt = src.indexOf("if (!isSessionAlive())")
        val signOutAt = src.indexOf("signOut()", aliveAt.coerceAtLeast(0))
        assertTrue(refreshAt >= 0, "$sequencerSource must attempt the refresh")
        assertTrue(aliveAt > refreshAt, "$sequencerSource must ask isSessionAlive only AFTER a failed refresh")
        assertTrue(signOutAt > aliveAt, "$sequencerSource must sign out only inside the not-alive branch")
    }

    @Test
    fun `both nav graphs register the ban destinations`() {
        // Android rendered BanScreen above its NavHost and registered no ban
        // routes, while both platforms fed their NavHost a start destination
        // from the same resolver — which can be `ban_device`. A NavHost whose
        // start destination is unregistered throws at launch.
        listOf(sharedNavGraph, appNavGraph).forEach { path ->
            val src = read(path)
            assertTrue(
                src.contains("composable(Screen.BanDevice.route)") &&
                    src.contains("composable(Screen.BanNetwork.route)"),
                "$path must register both ban destinations — the resolver can name either",
            )
            // Whole-unit: walk from each ban registration to the next one and
            // assert THAT block uses the graph-owned handler. A file-wide
            // `contains` would pass while one of the two screens still took the
            // caller's lambda, and a newline-sensitive pin would break the
            // first time anyone reformats the file.
            listOf("composable(Screen.BanDevice.route)", "composable(Screen.BanNetwork.route)").forEach { marker ->
                val start = src.indexOf(marker)
                assertTrue(start >= 0, "$path must register $marker")
                val rest = src.substring(start + marker.length)
                val nextComposable = rest.indexOf("composable(")
                val body = if (nextComposable > 0) rest.substring(0, nextComposable) else rest.take(400)
                assertTrue(
                    body.contains("onSignOut = signOutAndStay"),
                    "$path's $marker must use the graph-owned sign-out that leaves the user in place",
                )
                assertFalse(
                    body.contains("onSignOut = onSignOut"),
                    "$path's $marker must not take the caller's onSignOut — iOS passed one that " +
                        "navigated to Sign-In without signing out, the one destination a ban " +
                        "must never reach",
                )
            }
        }
    }

    @Test
    fun `both platforms run the cohort reconcile after the shell`() {
        // GATE 2 re-reads the claim the server already minted; only
        // `pm-lock-check` makes the server RECOMPUTE the cohort, and it ran on
        // the sign-in path alone — which post-SHY-0187 a returning user never
        // takes. A user whose birthday passed stayed in the minor cohort.
        listOf(mainActivity, mainViewController).forEach { path ->
            val src = read(path)
            assertTrue(
                src.contains("reconcileCohortInBackground("),
                "$path must run the cohort reconcile, or a cohort flip never reaches a returning user",
            )
            assertTrue(
                src.contains("checkPmLockOnLogin("),
                "$path's reconcile must actually call pm-lock-check — that is the only thing that " +
                    "makes the server recompute the cohort",
            )
        }
        // And it must not become a gate: the reconcile is a server-side
        // recompute, so anything that awaited it before releasing the shell
        // would put it back on the critical path the story took it off.
        val android = read(mainActivity)
        assertTrue(
            android.indexOf("checkComplete = true") < android.indexOf("reconcileCohortInBackground("),
            "$mainActivity must release the shell BEFORE reconciling",
        )
    }

    @Test
    fun `the iOS onSignOut argument actually signs out`() {
        // It used to ONLY navigate. `SharedNavGraph` invokes it on the
        // mid-session suspension path, so a suspended iPhone user was shown
        // Sign-In with their session, resolvedUniqueId and SessionCache record
        // intact — and the next cold start put them back on Main. The earlier
        // ban-screen fix routed AROUND this lambda without repairing it, which
        // is why a pin that only checks the ban blocks could not see it.
        val src = read(mainViewController)
        val at = src.indexOf("onSignOut = ")
        assertTrue(at >= 0, "$mainViewController must pass onSignOut")
        val body = src.substring(at, minOf(at + 900, src.length))
        assertTrue(
            body.contains("signOut()"),
            "$mainViewController's onSignOut must call signOut(), not merely navigate",
        )
    }

    @Test
    fun `BOTH platforms clear the API token cache inside signOut itself`() {
        // The invariant was being copied per call site and had reached 2 of 4
        // sites on Android and 0 of 3 on iOS — including the ban screen Android
        // actually renders, which lives in MainActivity, not the nav graph. A
        // pin that read only the nav graph was green against the wrong file.
        //
        // `signOut()` owns it now, so every present and future sign-out is
        // correct by default. That is the property worth pinning: not "the call
        // sites remember", but "they no longer have to".
        listOf(androidAuthRepo, iosAuthRepo).forEach { path ->
            val src = read(path)
            val at = src.indexOf("override suspend fun signOut()")
            assertTrue(at >= 0, "$path must implement signOut")
            val body = src.substring(at, minOf(at + 1400, src.length))
            assertTrue(
                body.contains("clearTokenCache()"),
                "$path's signOut must clear the cached bearer token — it survives 50 minutes, so " +
                    "a signed-out or banned process otherwise keeps a working one",
            )
        }
    }

    @Test
    fun `BOTH platforms clear the API token cache inside refreshIdToken`() {
        // Rotating the Firebase JWT while the API client serves a 50-minute
        // cached one leaves every Express call on the PRE-flip cohort claim.
        // Fixed on Android and left open on iOS, where GATE 2 and the
        // background reconcile both reach it.
        listOf(androidAuthRepo, iosAuthRepo).forEach { path ->
            val src = read(path)
            val at = src.indexOf("override suspend fun refreshIdToken()")
            assertTrue(at >= 0, "$path must implement refreshIdToken")
            val body = src.substring(at, minOf(at + 1400, src.length))
            assertTrue(
                body.contains("clearTokenCache()"),
                "$path's refreshIdToken must invalidate the cached token before rotating",
            )
        }
    }

    @Test
    fun `every ban screen on both platforms signs out rather than navigating`() {
        // Android renders its ban screen ABOVE the NavHost (MainActivity); iOS
        // routes to it (SharedNavGraph). Pinning one file covered one platform
        // while reading as though it covered both.
        listOf(mainActivity, sharedNavGraph).forEach { path ->
            val src = read(path)
            val at = src.indexOf("BanScreen(")
            assertTrue(at >= 0, "$path must render BanScreen")
            val body = src.substring(at, minOf(at + 1600, src.length))
            assertTrue(
                body.contains("signOut()") || body.contains("signOutAndStay"),
                "$path's BanScreen must sign out; Sign-In is the one destination a ban must never reach",
            )
            assertFalse(
                body.contains("navigate(Screen.SignIn.route)"),
                "$path's BanScreen must not navigate to Sign-In — a device or network ban follows " +
                    "the hardware or the IP, not the account",
            )
        }
    }

    @Test
    fun `every ban sign-out guards its own failure and outlives the composition`() {
        // Round 3 hardened Android's two sites and left the shared graph — the
        // one iOS actually routes ban screens from — with neither guard.
        // `rememberCoroutineScope()` has no CoroutineExceptionHandler, and
        // `signOut()` reaches the Keychain and Firebase, so an uncaught throw
        // crashed the app ON a ban screen. Pinning one platform's file is what
        // let that through, twice.
        listOf(appNavGraph, sharedNavGraph, mainActivity).forEach { path ->
            val src = read(path)
            val at =
                src
                    .indexOf("signOutAndStay")
                    .takeIf { it >= 0 }
                    ?: src.indexOf("onSignOut = {")
            assertTrue(at >= 0, "$path must define a ban sign-out")
            val body = src.substring(at, minOf(at + 1600, src.length))
            assertTrue(
                body.contains("CancellationException"),
                "$path's ban sign-out must rethrow CancellationException and catch the rest — " +
                    "an uncaught throw here crashes the app on the ban screen",
            )
        }
    }

    @Test
    fun `SessionCache is DI-registered on both platforms`() {
        // A commonMain class nothing constructs is a class nothing uses. Both
        // modules already register the SecureStorage it is built on, so the
        // realistic failure is registering it on one platform only — which
        // presents as iOS-crashes-on-launch, far from this change.
        listOf(androidKoinModule, iosKoinModule).forEach { path ->
            assertTrue(
                read(path).contains("SessionCache("),
                "$path must register SessionCache, or the platform cannot inject it",
            )
        }
    }
}
