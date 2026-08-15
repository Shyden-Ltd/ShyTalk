package com.shyden.shytalk

import android.content.Context
import android.content.Intent
import android.content.res.Configuration
import android.net.Uri
import android.os.Bundle
import android.util.Log
import androidx.activity.compose.setContent
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.size
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.ExperimentalComposeUiApi
import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId
import androidx.compose.ui.unit.dp
import androidx.lifecycle.DefaultLifecycleObserver
import androidx.lifecycle.LifecycleOwner
import androidx.lifecycle.ProcessLifecycleOwner
import androidx.lifecycle.lifecycleScope
import androidx.navigation.compose.rememberNavController
import com.google.firebase.auth.FirebaseAuth
import com.shyden.shytalk.core.BuildVariant
import com.shyden.shytalk.core.PreviewWatermark
import com.shyden.shytalk.core.push.AndroidPushPermissionBridge
import com.shyden.shytalk.core.push.PushPermissionStore
import com.shyden.shytalk.core.push.consumeChatDeepLink
import com.shyden.shytalk.core.push.refreshPushPermissionStateFromContext
import com.shyden.shytalk.core.push.verifyPushNavigation
import com.shyden.shytalk.core.room.ActiveRoomManager
import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.core.room.RoomService
import com.shyden.shytalk.core.util.LanguagePreference
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.UnsafeDeviceGate
import com.shyden.shytalk.core.util.logD
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.data.remote.AppConfigService
import com.shyden.shytalk.data.remote.StartingScreen
import com.shyden.shytalk.data.remote.WorkerApiClient
import com.shyden.shytalk.data.repository.AppLockRepository
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.DeviceRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.SessionCache
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.feature.legal.CURRENT_LEGAL_VERSION
import com.shyden.shytalk.feature.legal.CommunityStandardsScreen
import com.shyden.shytalk.feature.legal.CyberBullyingPolicyScreen
import com.shyden.shytalk.feature.legal.LegalAcceptanceScreen
import com.shyden.shytalk.feature.legal.TermsAndConditionsScreen
import com.shyden.shytalk.feature.privacy.PrivacyPolicyScreen
import com.shyden.shytalk.feature.security.UnsafeDeviceScreen
import com.shyden.shytalk.feature.starting.StartingScreenCache
import com.shyden.shytalk.feature.starting.StartingScreenComposable
import com.shyden.shytalk.feature.suspension.BanScreen
import com.shyden.shytalk.feature.update.DegradedModeScreen
import com.shyden.shytalk.feature.update.ForceUpdateScreen
import com.shyden.shytalk.navigation.BanState
import com.shyden.shytalk.navigation.ColdStartSequencer
import com.shyden.shytalk.navigation.LaunchState
import com.shyden.shytalk.navigation.NavGraph
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.navigation.isNavigationLockGated
import com.shyden.shytalk.navigation.reconcileCohortInBackground
import com.shyden.shytalk.navigation.toBanState
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import com.shyden.shytalk.util.formatBuiltAt
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.Job
import kotlinx.coroutines.async
import kotlinx.coroutines.delay
import kotlinx.coroutines.isActive
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.koin.android.ext.android.inject
import org.koin.core.qualifier.named

private const val TAG = "MainActivity"

class MainActivity : AppCompatActivity() {
    private val authRepository: AuthRepository by inject()
    private val userRepository: UserRepository by inject()
    private val privateMessageRepository: PrivateMessageRepository by inject()
    private val workerApiClient: WorkerApiClient by inject()
    private val activeRoomManager: RoomLifecycleManager by inject()
    private val appConfigService: AppConfigService by inject()
    private val biometricAuth: com.shyden.shytalk.core.util.BiometricAuth by inject()
    private val appLockRepository: AppLockRepository by inject()

    // SHY-0143 — the pre-routing ban gate's collaborators. `deviceId` is the
    // same named singleton AuthViewModel takes, so the hoisted check asks the
    // identical question the sign-in path already asked.
    private val deviceRepository: DeviceRepository by inject()
    private val deviceId: String by inject(named("deviceId"))

    // SHY-0143 — the cold-start identity cache, read before routing so
    // `resolvedUniqueId` is real by the time any destination is chosen.
    private val sessionCache: SessionCache by inject()

    private val navigateToRoomState = mutableStateOf<String?>(null)
    private val navigateToChatState = mutableStateOf<Pair<String, Boolean>?>(null) // (id, isGroup)

    // In-room PM intent (id, isGroup): published by handleRoomIntent, consumed
    // by a gated LaunchedEffect in composition. NEVER open the PM sheet
    // directly from the intent handler — it runs before ON_RESUME can
    // interpose the App-Lock and it has no navController for the gate's
    // currentRoute (SHY-0187 R2 Critical).
    private val pendingInRoomPmState = mutableStateOf<Pair<String, Boolean>?>(null)
    private val pendingEmailLinkState = mutableStateOf<String?>(null)
    private val showLeaveConfirmationState = mutableStateOf(false)
    private var lastSeenJob: Job? = null

    // Tracked so we can removeObserver in onDestroy. ProcessLifecycleOwner
    // is process-scoped, so observers registered in Activity onCreate
    // outlive the Activity. Without explicit removal, every config change
    // (rotation, locale switch via attachBaseContext) accumulates a new
    // observer, each independently calling appLockRepository on every
    // background transition.
    private var processLifecycleObserver: DefaultLifecycleObserver? = null

    override fun attachBaseContext(newBase: Context) {
        val language = LanguagePreference.get()
        val locale = java.util.Locale.forLanguageTag(language)
        java.util.Locale.setDefault(locale)
        val config = Configuration(newBase.resources.configuration).apply { setLocale(locale) }
        super.attachBaseContext(newBase.createConfigurationContext(config))
    }

    override fun onCreate(savedInstanceState: Bundle?) {
        super.onCreate(savedInstanceState)
        BuildVariant.initLocalEmulator(
            value = BuildConfig.FLAVOR == "local",
            devPersonasPassword = BuildConfig.DEV_QA_PERSONAS_PASSWORD,
            googleWebClientId = BuildConfig.WEB_CLIENT_ID,
        )
        // Drives the PreviewWatermark overlay — non-prod builds get a
        // "ShyTalk Preview" badge on every screen so leaked screenshots
        // are unmistakably staging. Flavor maps directly to environment
        // ("prod" → no watermark; everything else → watermark).
        // builtAt = install time (SHY-0205): a reinstall always follows a
        // build in the QA loop, and unlike a baked constant it cannot go
        // stale under gradle's configuration cache.
        val installedAt =
            runCatching {
                formatBuiltAt(packageManager.getPackageInfo(packageName, 0).lastUpdateTime)
            }.getOrDefault("")
        BuildVariant.initBuildInfo(
            environment = BuildConfig.FLAVOR,
            buildVersion = "${BuildConfig.VERSION_NAME} (${BuildConfig.VERSION_CODE})",
            deviceInfo = "${android.os.Build.MANUFACTURER} ${android.os.Build.MODEL} · Android ${android.os.Build.VERSION.RELEASE}",
            gitBranch = BuildConfig.GIT_BRANCH,
            gitSha = BuildConfig.GIT_SHA,
            gitDirty = BuildConfig.GIT_DIRTY,
            builtAt = installedAt,
        )
        logD(
            "MainActivity",
            "build identity: ${BuildConfig.FLAVOR} ${BuildConfig.VERSION_NAME}(${BuildConfig.VERSION_CODE}) " +
                "${BuildConfig.GIT_BRANCH}@${BuildConfig.GIT_SHA}${if (BuildConfig.GIT_DIRTY) "*" else ""} installed $installedAt",
        )
        biometricAuth.setActivity(this)
        enableEdgeToEdge()

        // applicationContext (not `this`) so the bridge outlives Activity recreations without leaking it.
        PushPermissionStore.registerBridge(AndroidPushPermissionBridge(applicationContext))
        refreshPushPermissionStateFromContext(applicationContext)

        // Track app background/foreground for lock timeout. Save the
        // observer so it can be removed in onDestroy — ProcessLifecycleOwner
        // is process-scoped and would otherwise accumulate observers
        // across config-change Activity recreations.
        val observer =
            object : DefaultLifecycleObserver {
                override fun onStop(owner: LifecycleOwner) {
                    // App went to background — record timestamp
                    appLockRepository.updateLastActiveTimestamp()
                }
            }
        ProcessLifecycleOwner.get().lifecycle.addObserver(observer)
        processLifecycleObserver = observer

        setContent {
            ShyTalkTheme(darkTheme = true) {
                @OptIn(ExperimentalComposeUiApi::class)
                androidx.compose.foundation.layout.Box(
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .semantics { testTagsAsResourceId = true },
                ) {
                    PreviewWatermark {
                        // Starting screen states (checked FIRST, before all other checks)
                        var startingScreenCheckDone by remember { mutableStateOf(false) }
                        var blockingScreen by remember { mutableStateOf<StartingScreen?>(null) }
                        var dismissableScreens by remember { mutableStateOf<List<StartingScreen>>(emptyList()) }
                        var blockingScreenDismissed by remember { mutableStateOf(false) }
                        var dismissableScreenIndex by remember { mutableStateOf(0) }

                        var updateRequired by remember { mutableStateOf(false) }
                        var checkComplete by remember { mutableStateOf(false) }

                        // SHY-0143 — decided by ColdStartSequencer in the
                        // pre-routing effect, not at NavHost-mount time. It has to
                        // be state rather than a `remember { }` because the
                        // decision now depends on awaited work (the ban verdict and
                        // the token refresh), and a `remember` block cannot suspend.
                        // Null until the sequence finishes; the NavHost does not
                        // mount before then.
                        var initialRoute by remember { mutableStateOf<String?>(null) }

                        // SHY-0143 — gates the nav graph's user-flag
                        // subscription. False until a token refresh actually
                        // confirms the cohort claim.
                        var cohortVerified by remember { mutableStateOf(false) }

                        // SHY-0143 — the pre-routing ban gate. Resolved inside the
                        // SAME pre-routing phase as the emulator gate + version and
                        // health checks, so it adds no new blocking phase and the
                        // existing `!checkComplete` spinner already prevents ANY
                        // content rendering while it is outstanding.
                        var coldStartBan by remember { mutableStateOf(BanState()) }
                        var softUpdateAvailable by remember { mutableStateOf<String?>(null) }
                        var isUnsafe by remember { mutableStateOf(false) }
                        var backendDegraded by remember { mutableStateOf(false) }
                        var degradedAcknowledged by remember { mutableStateOf(false) }
                        var legalAccepted by remember {
                            mutableStateOf(LanguagePreference.getAcceptedLegalVersion() >= CURRENT_LEGAL_VERSION)
                        }
                        var viewingLegalDoc by remember { mutableStateOf<String?>(null) }

                        val cache = remember { StartingScreenCache(this@MainActivity) }

                        // Starting screens check — runs FIRST before all other checks
                        LaunchedEffect(Unit) {
                            // Check cache first for immediate blocking
                            val cached = cache.getCachedBlocker()

                            when (val result = appConfigService.getStartingScreens()) {
                                is Resource.Success -> {
                                    val screens = result.data
                                    val enabledScreens = screens.values.filter { it.enabled }
                                    val blocker = enabledScreens.firstOrNull { !it.dismissable }
                                    if (blocker != null) {
                                        if (cached?.contentHash != blocker.contentHash) {
                                            cache.cacheBlocker(blocker, null)
                                        }
                                        blockingScreen = blocker
                                    } else {
                                        cache.clearBlocker()
                                        dismissableScreens =
                                            enabledScreens
                                                .filter { it.dismissable }
                                                .filter { it.frequency != "once" || !cache.isDismissed(it.screenId) }
                                    }
                                }

                                is Resource.Error -> {
                                    if (cached != null) {
                                        blockingScreen = cached.toStartingScreen()
                                    }
                                }

                                is Resource.Loading -> { /* wait */ }
                            }
                            startingScreenCheckDone = true
                        }

                        // Existing update/health checks — only runs after starting screen check passes
                        LaunchedEffect(startingScreenCheckDone) {
                            if (!startingScreenCheckDone) return@LaunchedEffect
                            // Don't run further checks if blocked
                            if (blockingScreen != null) return@LaunchedEffect

                            // Anti-emulator / anti-root gate. See UnsafeDeviceGate
                            // for the bypass logic + flavor-by-flavor matrix.
                            isUnsafe = UnsafeDeviceGate.isBlocked()

                            // SHY-0143 — put the REAL uniqueId in place before any
                            // routing decision is taken.
                            //
                            // Every screen behind this gate keys its reads on
                            // `AuthRepository.currentUserId`, which falls back to
                            // the raw Firebase UID until `resolvedUniqueId` is set
                            // — and nothing on the cold-start route to Main sets
                            // it. `AuthViewModel.init` is the only code that ever
                            // did, and an AuthViewModel is constructed solely
                            // inside the Sign-In / e-mail-OTP route composables,
                            // which SHY-0187 stopped routing cold starts through.
                            //
                            // One bounded read of encrypted local storage: no
                            // network, no suspension, nothing to await. The cache
                            // rejects a record belonging to a different Firebase
                            // user, so a miss here is a genuine miss.
                            val cached = sessionCache.read(authRepository.currentFirebaseUid)
                            if (cached != null) {
                                authRepository.resolvedUniqueId = cached.uniqueId
                                authRepository.resolvedCohort = cached.cohort
                                logI(TAG, "Cold-start identity restored from cache (cohort=${cached.cohort})")
                            } else {
                                // Not an error — first launch after this shipped,
                                // a cleared cache, or a different account. Routing
                                // falls back to resolve-then-route via the Lock
                                // screen, which is what happened before SHY-0187.
                                logI(TAG, "Cold-start identity cache miss — resolve-then-route fallback")
                            }

                            // SHY-0143 — device + network ban check, hoisted OUT of
                            // the sign-in flow.
                            //
                            // It used to run only inside AuthViewModel's
                            // resolveIdentityAndProceed(), so SHY-0187's optimistic
                            // cold start — which routes a restored session straight
                            // to Main without signing in — skipped it entirely. A
                            // banned device, or a banned IP/subnet/ASN (the same
                            // path that blocks VPNs), reached the room list.
                            //
                            // Started with async so it overlaps the version and
                            // health round-trips rather than adding a serial leg;
                            // awaited before `checkComplete`, which is what keeps
                            // any content from rendering ahead of the verdict.
                            val banDeferred = async { deviceRepository.checkBanStatus(deviceId) }

                            when (val result = appConfigService.getLatestVersionInfo()) {
                                is Resource.Success -> {
                                    val (minVersionCode, latestVersionCode, latestVersionName) = result.data
                                    updateRequired = appConfigService.currentVersionCode < minVersionCode
                                    if (!updateRequired && appConfigService.currentVersionCode < latestVersionCode) {
                                        softUpdateAvailable = latestVersionName.ifEmpty { "v$latestVersionCode" }
                                    }
                                }

                                is Resource.Error -> {
                                    updateRequired = false
                                }

                                is Resource.Loading -> { /* wait */ }
                            }
                            when (val healthResult = appConfigService.checkBackendHealth()) {
                                is Resource.Success -> {
                                    backendDegraded = healthResult.data.status == "degraded"
                                }

                                else -> {}
                            }
                            // SHY-0143 — the whole cold-start sequence, in one
                            // shared object both platforms run.
                            //
                            // The two orderings that carry the security are
                            // enforced by ColdStartSequencer rather than by the
                            // order these lines happen to appear in:
                            //   1. bans are known BEFORE the destination is
                            //      chosen, and
                            //   2. the cohort claim is refreshed BEFORE any
                            //      cohort-scoped read is issued.
                            //
                            // `startCohortScopedReads` is a no-op here because
                            // in Compose that event IS the NavHost mounting, and
                            // the NavHost cannot mount until `checkComplete`
                            // below — which happens after `run()` returns. The
                            // ordering is therefore structural, not conventional.
                            val sequencer =
                                ColdStartSequencer(
                                    // Awaits the deferred started above, so the
                                    // ban round-trip still overlaps the version
                                    // and health calls rather than adding a leg.
                                    //
                                    // Lenient on a transient failure, matching
                                    // the long-standing behaviour
                                    // AuthViewModelBanTest pins ("ban check error
                                    // is lenient"): a ban-service blip must not
                                    // lock out a legitimate user. A real ban is
                                    // authoritative; an unreachable service is
                                    // not evidence of one.
                                    checkBans = {
                                        when (val banResult = banDeferred.await()) {
                                            is Resource.Success -> banResult.data.toBanState()
                                            else -> BanState()
                                        }
                                    },
                                    // The cheap primitive that re-reads custom
                                    // claims. A restored session's token carries
                                    // LAST session's cohort, and rendering a
                                    // cohort-scoped room list on it is the
                                    // SHY-0132/0137 cross-cohort leak.
                                    refreshToken = { authRepository.refreshIdToken() is Resource.Success },
                                    // Separates a revoked token from an
                                    // unreachable network: Firebase drops its
                                    // local user on a genuine revocation.
                                    isSessionAlive = { authRepository.isAuthenticated },
                                    startCohortScopedReads = {},
                                    signOut = { authRepository.signOut() },
                                    launchState = {
                                        LaunchState(
                                            hasStoredCredential = appLockRepository.hasCredential,
                                            isAppLockEnabled = appLockRepository.isAppLockEnabled,
                                            isLockRequired = appLockRepository.isLockRequired(),
                                            isAuthenticated = authRepository.isAuthenticated,
                                            hasResolvedUser = authRepository.resolvedUniqueId != null,
                                        )
                                    },
                                )
                            val destination = sequencer.run()
                            coldStartBan = sequencer.lastBan
                            cohortVerified = sequencer.cohortVerified
                            initialRoute = destination.route
                            logI(
                                TAG,
                                "Cold-launch destination: ${destination.route} " +
                                    "(lockGated=${destination == Screen.Lock}, " +
                                    "banned=${sequencer.lastBan.deviceBanned || sequencer.lastBan.networkBanned})",
                            )

                            checkComplete = true

                            // SHY-0143 I5 — the cohort reconcile, AFTER the
                            // shell is released and deliberately not awaited.
                            //
                            // GATE 2 above re-reads whatever claim the server
                            // has already minted; only `pm-lock-check` makes the
                            // server RECOMPUTE the cohort. It ran on the sign-in
                            // path alone, and a returning user never signs in —
                            // so a user whose birthday passed stayed in the
                            // minor cohort indefinitely.
                            //
                            // Launched rather than awaited because it is a
                            // server-side recompute: the story requires it off
                            // the critical path, and nothing routes on it.
                            if (cohortVerified) {
                                val reconcileId = authRepository.resolvedUniqueId
                                if (reconcileId != null) {
                                    lifecycleScope.launch {
                                        reconcileCohortInBackground(
                                            uniqueId = reconcileId,
                                            checkPmLock = { id ->
                                                val r = userRepository.checkPmLockOnLogin(id)
                                                r is Resource.Success && r.data.forceTokenRefresh
                                            },
                                            refreshToken = { authRepository.refreshIdToken() is Resource.Success },
                                            log = { message -> logI(TAG, message) },
                                        )
                                    }
                                }
                            }
                        }

                        // Poll health every 5 minutes while degraded; clear when recovered
                        LaunchedEffect(backendDegraded) {
                            if (!backendDegraded) return@LaunchedEffect
                            while (true) {
                                delay(300_000L) // 5 minutes
                                when (val result = appConfigService.checkBackendHealth()) {
                                    is Resource.Success -> {
                                        if (result.data.status == "ok") {
                                            backendDegraded = false
                                            return@LaunchedEffect
                                        }
                                    }

                                    else -> {} // still degraded
                                }
                            }
                        }

                        when {
                            !startingScreenCheckDone -> {
                                // Loading spinner while checking starting screens
                                Surface(
                                    color = MaterialTheme.colorScheme.background,
                                    modifier = Modifier.fillMaxSize(),
                                ) {
                                    Column(
                                        modifier = Modifier.fillMaxSize(),
                                        horizontalAlignment = Alignment.CenterHorizontally,
                                        verticalArrangement = Arrangement.Center,
                                    ) {
                                        CircularProgressIndicator(
                                            modifier = Modifier.size(24.dp),
                                            strokeWidth = 2.dp,
                                            color = MaterialTheme.colorScheme.primary,
                                        )
                                        Spacer(modifier = Modifier.height(12.dp))
                                        Text(
                                            text = stringResource(Res.string.starting_screen_loading),
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            }

                            blockingScreen != null && !blockingScreenDismissed -> {
                                // Blocking screen — STOPS all further loading
                                StartingScreenComposable(
                                    screen = blockingScreen!!,
                                    onDismiss = { blockingScreenDismissed = true },
                                )
                            }

                            !checkComplete -> {
                                Surface(
                                    color = MaterialTheme.colorScheme.background,
                                    modifier = Modifier.fillMaxSize(),
                                ) {
                                    Column(
                                        modifier = Modifier.fillMaxSize(),
                                        horizontalAlignment = Alignment.CenterHorizontally,
                                        verticalArrangement = Arrangement.Center,
                                    ) {
                                        CircularProgressIndicator(
                                            modifier = Modifier.size(24.dp),
                                            strokeWidth = 2.dp,
                                            color = MaterialTheme.colorScheme.primary,
                                        )
                                        Spacer(modifier = Modifier.height(12.dp))
                                        Text(
                                            text = stringResource(Res.string.checking_for_updates),
                                            style = MaterialTheme.typography.bodyMedium,
                                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                                        )
                                    }
                                }
                            }

                            isUnsafe -> {
                                UnsafeDeviceScreen()
                            }

                            // SHY-0143 — rendered HERE, above the NavHost, rather
                            // than routed to. The NavHost never mounts for a banned
                            // start, so no cohort-scoped subscription can be issued
                            // and no room-list shell flashes first.
                            //
                            // Deliberately BELOW isUnsafe: a rooted or emulated
                            // device keeps showing UnsafeDeviceScreen exactly as
                            // before, preserving that gate's precedence unchanged
                            // (both outcomes block, so nothing is lost).
                            //
                            // Signing out does not clear a device or network ban —
                            // those follow the hardware or the IP/subnet/ASN, not
                            // the account — so the user stays on this screen.
                            coldStartBan.deviceBanned || coldStartBan.networkBanned -> {
                                BanScreen(
                                    banType = if (coldStartBan.deviceBanned) "device" else "network",
                                    reason = coldStartBan.reason,
                                    expiresAt = coldStartBan.expiresAt,
                                    onSignOut = { lifecycleScope.launch { authRepository.signOut() } },
                                )
                            }

                            updateRequired -> {
                                ForceUpdateScreen()
                            }

                            backendDegraded && !degradedAcknowledged -> {
                                DegradedModeScreen(onAcknowledge = { degradedAcknowledged = true })
                            }

                            !legalAccepted -> {
                                when (viewingLegalDoc) {
                                    "privacy" ->
                                        PrivacyPolicyScreen(
                                            onAccept = {},
                                            onDecline = {},
                                            onNavigateBack = { viewingLegalDoc = null },
                                            showActions = false,
                                        )

                                    "community" ->
                                        CommunityStandardsScreen(
                                            onNavigateBack = { viewingLegalDoc = null },
                                        )

                                    "terms" ->
                                        TermsAndConditionsScreen(
                                            onNavigateBack = { viewingLegalDoc = null },
                                        )

                                    "cyberbullying" ->
                                        CyberBullyingPolicyScreen(
                                            onNavigateBack = { viewingLegalDoc = null },
                                        )

                                    else ->
                                        LegalAcceptanceScreen(
                                            onAccept = {
                                                LanguagePreference.setAcceptedLegalVersion(CURRENT_LEGAL_VERSION)
                                                legalAccepted = true
                                            },
                                            onViewPrivacyPolicy = { viewingLegalDoc = "privacy" },
                                            onViewCommunityStandards = { viewingLegalDoc = "community" },
                                            onViewTerms = { viewingLegalDoc = "terms" },
                                            onViewCyberBullyingPolicy = { viewingLegalDoc = "cyberbullying" },
                                        )
                                }
                            }

                            dismissableScreens.isNotEmpty() && dismissableScreenIndex < dismissableScreens.size -> {
                                val currentScreen = dismissableScreens[dismissableScreenIndex]
                                StartingScreenComposable(
                                    screen = currentScreen,
                                    onDismiss = {
                                        if (currentScreen.frequency == "once") {
                                            cache.markDismissed(currentScreen.screenId)
                                        }
                                        dismissableScreenIndex++
                                    },
                                )
                            }

                            else -> {
                                val navController = rememberNavController()
                                val navigateToRoomId by navigateToRoomState

                                LaunchedEffect(navigateToRoomId) {
                                    val roomId = navigateToRoomId
                                    if (roomId != null) {
                                        // SHY-0187: a push/intent must never navigate over
                                        // (or ahead of) the App-Lock — drop it, fail-closed,
                                        // like the identity-not-resolved drop below.
                                        if (isNavigationLockGated(
                                                hasStoredCredential = appLockRepository.hasCredential,
                                                isAppLockEnabled = appLockRepository.isAppLockEnabled,
                                                isLockRequired = appLockRepository.isLockRequired(),
                                                isAuthenticated = authRepository.isAuthenticated,
                                                hasResolvedUser = authRepository.resolvedUniqueId != null,
                                                currentRoute = navController.currentDestination?.route,
                                            )
                                        ) {
                                            logI(TAG, "Room deep-link dropped — App-Lock is gating")
                                            navigateToRoomState.value = null
                                            return@LaunchedEffect
                                        }
                                        navController.navigate(Screen.Room.createRoute(roomId)) {
                                            launchSingleTop = true
                                        }
                                        navigateToRoomState.value = null
                                    }
                                }

                                val navigateToChatInfo by navigateToChatState

                                // Push deep-link authorisation re-check — delegates to
                                // commonMain `verifyPushNavigation` so iOS and Android
                                // share the same authz semantics (timeout, identity
                                // gate, block-list gate, group conversation-membership
                                // gate; all fail-closed). Use `resolvedUniqueId`
                                // explicitly to avoid the cold-start race where
                                // `currentUserId` falls back to the Firebase UID
                                // before identity resolution completes.
                                LaunchedEffect(navigateToChatInfo) {
                                    val chatInfo = navigateToChatInfo
                                    if (chatInfo != null) {
                                        val (id, isGroup) = chatInfo
                                        // SHY-0187: the App-Lock gate outranks even an
                                        // authorized deep link (fail-closed drop).
                                        if (isNavigationLockGated(
                                                hasStoredCredential = appLockRepository.hasCredential,
                                                isAppLockEnabled = appLockRepository.isAppLockEnabled,
                                                isLockRequired = appLockRepository.isLockRequired(),
                                                isAuthenticated = authRepository.isAuthenticated,
                                                hasResolvedUser = authRepository.resolvedUniqueId != null,
                                                currentRoute = navController.currentDestination?.route,
                                            )
                                        ) {
                                            logI(TAG, "Chat deep-link dropped — App-Lock is gating")
                                            navigateToChatState.value = null
                                            return@LaunchedEffect
                                        }
                                        val currentUserId = authRepository.resolvedUniqueId
                                        if (currentUserId.isNullOrEmpty()) {
                                            Log.w(TAG, "Push deep-link dropped — identity not yet resolved or signed out")
                                            navigateToChatState.value = null
                                            return@LaunchedEffect
                                        }
                                        val authzOk =
                                            verifyPushNavigation(
                                                currentUserId = currentUserId,
                                                targetId = id,
                                                isGroup = isGroup,
                                                fetchBlockedUserIds = { userRepository.getBlockedUserIds(it) },
                                                fetchConversation = { privateMessageRepository.getConversation(it) },
                                            )
                                        if (!authzOk) {
                                            navigateToChatState.value = null
                                            return@LaunchedEffect
                                        }
                                        val route =
                                            if (isGroup) {
                                                Screen.GroupChat.createRoute(id)
                                            } else {
                                                Screen.PrivateChat.createRoute(id)
                                            }
                                        navController.navigate(route) {
                                            launchSingleTop = true
                                        }
                                        navigateToChatState.value = null
                                        // Also clear the shared chatDeepLinks bus so a
                                        // future tri-platform unification through that
                                        // channel doesn't leave a stale link. Idempotent.
                                        consumeChatDeepLink()
                                    }
                                }

                                val pendingInRoomPm by pendingInRoomPmState

                                // SHY-0187 R2: in-room PM intents (a PM push tapped
                                // while live in a room) get the SAME gates as the
                                // navigate path — the App-Lock outranks the link
                                // (fail-closed drop), then the push-authz re-check
                                // (block-list + group membership, fail-closed).
                                LaunchedEffect(pendingInRoomPm) {
                                    val pmIntent = pendingInRoomPm
                                    if (pmIntent != null) {
                                        val (id, isGroup) = pmIntent
                                        if (isNavigationLockGated(
                                                hasStoredCredential = appLockRepository.hasCredential,
                                                isAppLockEnabled = appLockRepository.isAppLockEnabled,
                                                isLockRequired = appLockRepository.isLockRequired(),
                                                isAuthenticated = authRepository.isAuthenticated,
                                                hasResolvedUser = authRepository.resolvedUniqueId != null,
                                                currentRoute = navController.currentDestination?.route,
                                            )
                                        ) {
                                            logI(TAG, "In-room PM intent dropped — App-Lock is gating")
                                            pendingInRoomPmState.value = null
                                            return@LaunchedEffect
                                        }
                                        val currentUserId = authRepository.resolvedUniqueId
                                        if (currentUserId.isNullOrEmpty()) {
                                            Log.w(TAG, "In-room PM intent dropped — identity not yet resolved or signed out")
                                            pendingInRoomPmState.value = null
                                            return@LaunchedEffect
                                        }
                                        val authzOk =
                                            verifyPushNavigation(
                                                currentUserId = currentUserId,
                                                targetId = id,
                                                isGroup = isGroup,
                                                fetchBlockedUserIds = { userRepository.getBlockedUserIds(it) },
                                                fetchConversation = { privateMessageRepository.getConversation(it) },
                                            )
                                        if (!authzOk) {
                                            pendingInRoomPmState.value = null
                                            return@LaunchedEffect
                                        }
                                        val mgr = activeRoomManager as? ActiveRoomManager
                                        if (isGroup) {
                                            mgr?.requestOpenPm(groupConversationId = id)
                                        } else {
                                            mgr?.requestOpenPm(userId = id)
                                        }
                                        pendingInRoomPmState.value = null
                                    }
                                }

                                val pendingEmailLink by pendingEmailLinkState

                                // SHY-0187 / SHY-0143: the destination was
                                // decided by ColdStartSequencer above, which is
                                // what guarantees the ban verdict and the fresh
                                // cohort claim both precede this mount. A null
                                // route means the sequence has not finished — the
                                // `!checkComplete` branch above is already showing
                                // the spinner, and mounting a NavHost with no start
                                // destination would crash.
                                initialRoute?.let { route ->
                                    NavGraph(
                                        navController = navController,
                                        startDestination = route,
                                        coldStartBan = coldStartBan,
                                        cohortVerified = cohortVerified,
                                        isBackendDegraded = backendDegraded,
                                        pendingEmailLink = pendingEmailLink,
                                        onEmailLinkConsumed = { pendingEmailLinkState.value = null },
                                        onSignOut = {
                                            workerApiClient.clearTokenCache()
                                            // Process-scoped: sign-out must finish even if this
                                            // Activity is destroyed by the navigation it triggers.
                                            // Rethrow CancellationException to keep structured
                                            // concurrency intact when the scope is cancelled.
                                            ProcessLifecycleOwner.get().lifecycleScope.launch {
                                                try {
                                                    authRepository.signOut()
                                                } catch (e: CancellationException) {
                                                    throw e
                                                } catch (e: Exception) {
                                                    Log.e(TAG, "authRepository.signOut() failed: ${e.message}", e)
                                                }
                                            }
                                        },
                                    )
                                }

                                softUpdateAvailable?.let { version ->
                                    AlertDialog(
                                        onDismissRequest = { softUpdateAvailable = null },
                                        title = { Text(stringResource(Res.string.update_available)) },
                                        text = { Text(stringResource(Res.string.update_available_soft, version)) },
                                        confirmButton = {
                                            TextButton(onClick = {
                                                softUpdateAvailable = null
                                                startActivity(
                                                    Intent(
                                                        Intent.ACTION_VIEW,
                                                        Uri.parse("https://play.google.com/store/apps/details?id=com.shyden.shytalk"),
                                                    ),
                                                )
                                            }) { Text(stringResource(Res.string.update_now)) }
                                        },
                                        dismissButton = {
                                            TextButton(onClick = { softUpdateAvailable = null }) {
                                                Text(stringResource(Res.string.later))
                                            }
                                        },
                                    )
                                }
                            }
                        }

                        // Leave room confirmation dialog (triggered by chathead X tap)
                        val showLeaveDialog by showLeaveConfirmationState
                        if (showLeaveDialog) {
                            val isOwner = activeRoomManager.activeRoom.value?.ownerId == activeRoomManager.currentUserId
                            AlertDialog(
                                onDismissRequest = { showLeaveConfirmationState.value = false },
                                title = {
                                    Text(
                                        if (isOwner) {
                                            stringResource(
                                                Res.string.close_room_question,
                                            )
                                        } else {
                                            stringResource(Res.string.leave_room_question)
                                        },
                                    )
                                },
                                text = {
                                    Text(
                                        if (isOwner) {
                                            stringResource(Res.string.close_room_description)
                                        } else {
                                            stringResource(Res.string.leave_room_description)
                                        },
                                    )
                                },
                                confirmButton = {
                                    TextButton(onClick = {
                                        showLeaveConfirmationState.value = false
                                        val intent =
                                            Intent(this@MainActivity, RoomService::class.java).apply {
                                                action = "CONFIRM_DISMISS"
                                            }
                                        startService(intent)
                                    }) { Text(stringResource(Res.string.leave)) }
                                },
                                dismissButton = {
                                    TextButton(onClick = { showLeaveConfirmationState.value = false }) {
                                        Text(stringResource(Res.string.cancel))
                                    }
                                },
                            )
                        }
                    }
                } // close Box(testTagsAsResourceId)
            }
        }

        // Handle notification tap to open room (cold start)
        handleRoomIntent(intent)
    }

    override fun onResume() {
        super.onResume()
        activeRoomManager.isAppInForeground = true
        startLastSeenUpdates()
        // Catches the user toggling the OS notification setting while paused.
        refreshPushPermissionStateFromContext(applicationContext)
    }

    override fun onStop() {
        super.onStop()
        activeRoomManager.isAppInForeground = false
        lastSeenJob?.cancel()
        lastSeenJob = null
    }

    private fun startLastSeenUpdates() {
        lastSeenJob?.cancel()
        lastSeenJob =
            CoroutineScope(Dispatchers.IO).launch {
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
        intent ?: return

        // Handle email sign-in deep link
        val data = intent.data?.toString()
        if (data != null && FirebaseAuth.getInstance().isSignInWithEmailLink(data)) {
            pendingEmailLinkState.value = data
            return
        }

        // Handle PM notification tap (navigateTo=chat)
        val navigateTo = intent.getStringExtra("navigateTo")
        if (navigateTo == "chat") {
            val isGroup = intent.getBooleanExtra("isGroup", false)
            val inRoom = activeRoomManager.activeRoomId.value != null

            if (inRoom) {
                // User is in a room — open PmBottomSheet within the room instead
                // of navigating away. Published as pending state (NOT a direct
                // requestOpenPm): this method runs synchronously in
                // onCreate/onNewIntent, BEFORE ON_RESUME can interpose the
                // App-Lock, and the composition-side effect also re-checks push
                // authz — same fail-closed semantics as the navigate path.
                val id =
                    if (isGroup) {
                        intent.getStringExtra("conversationId")
                    } else {
                        intent.getStringExtra("otherUserId")
                    }
                if (id != null) {
                    pendingInRoomPmState.value = id to isGroup
                }
            } else {
                if (isGroup) {
                    val conversationId = intent.getStringExtra("conversationId")
                    if (conversationId != null) {
                        navigateToChatState.value = conversationId to true
                    }
                } else {
                    val otherUserId = intent.getStringExtra("otherUserId")
                    if (otherUserId != null) {
                        navigateToChatState.value = otherUserId to false
                    }
                }
            }
            return
        }

        when (intent.action) {
            "OPEN_ROOM" -> {
                val roomId = intent.getStringExtra("roomId")
                if (roomId != null) {
                    navigateToRoomState.value = roomId
                }
            }

            "CONFIRM_LEAVE_ROOM" -> {
                showLeaveConfirmationState.value = true
            }
        }
    }

    override fun onDestroy() {
        super.onDestroy()
        processLifecycleObserver?.let {
            ProcessLifecycleOwner.get().lifecycle.removeObserver(it)
        }
        processLifecycleObserver = null
    }
}
