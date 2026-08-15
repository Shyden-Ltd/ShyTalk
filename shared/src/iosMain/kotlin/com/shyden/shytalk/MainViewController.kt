package com.shyden.shytalk

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.produceState
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.window.ComposeUIViewController
import androidx.navigation.compose.rememberNavController
import com.shyden.shytalk.core.PreviewWatermark
import com.shyden.shytalk.core.push.chatDeepLinks
import com.shyden.shytalk.core.push.consumeChatDeepLink
import com.shyden.shytalk.core.push.verifyPushNavigation
import com.shyden.shytalk.core.util.LanguagePreference
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.core.util.logW
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
import com.shyden.shytalk.navigation.BanState
import com.shyden.shytalk.navigation.ColdStartSequencer
import com.shyden.shytalk.navigation.IosPlatformNavCallbacks
import com.shyden.shytalk.navigation.LaunchState
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.navigation.SharedNavGraph
import com.shyden.shytalk.navigation.createIosPlatformScreens
import com.shyden.shytalk.navigation.isNavigationLockGated
import com.shyden.shytalk.navigation.toBanState
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import kotlinx.coroutines.flow.filterNotNull
import org.koin.core.qualifier.named
import org.koin.mp.KoinPlatformTools

@Suppress("ktlint:standard:function-naming")
fun MainViewController() = ComposeUIViewController { IosApp() }

@Composable
private fun IosApp() {
    var legalAccepted by remember {
        mutableStateOf(LanguagePreference.getAcceptedLegalVersion() >= CURRENT_LEGAL_VERSION)
    }
    var viewingLegalDoc by remember { mutableStateOf<String?>(null) }

    ShyTalkTheme(darkTheme = true) {
        PreviewWatermark {
            if (!legalAccepted) {
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
            } else {
                val navController = rememberNavController()
                val platformCallbacks = remember { IosPlatformNavCallbacks() }
                val platformScreens = remember { createIosPlatformScreens() }

                // Push notification deep links: navigate to the right chat when the
                // user taps a notification. The bus is a nullable StateFlow — collect
                // non-null values, navigate, then `consume()` to clear so a re-subscribe
                // (e.g. after sign-out → sign-in re-creating the NavGraph) does NOT
                // re-fire the link from the previous user session.
                //
                // Authorisation re-check before navigation: a compromised FCM project
                // (or anyone with the FCM server key) could deliver a payload that
                // opens a chat with an arbitrary uniqueId, bypassing block / friend
                // gating in the UI. Firestore rules enforce the actual security
                // boundary at message-read time, but the chat-screen header would
                // briefly flash the target's display name / photo before failure.
                // Re-validate signed-in state and block status here so the
                // navigation never starts for invalid targets.
                LaunchedEffect(navController) {
                    chatDeepLinks.filterNotNull().collect { link ->
                        val koin = KoinPlatformTools.defaultContext().get()
                        val authRepo = koin.get<AuthRepository>()
                        // SHY-0187: the App-Lock gate outranks even an authorized
                        // deep link — drop, fail-closed (same as Android).
                        val lockRepo = koin.get<AppLockRepository>()
                        if (isNavigationLockGated(
                                hasStoredCredential = lockRepo.hasCredential,
                                isAppLockEnabled = lockRepo.isAppLockEnabled,
                                isLockRequired = lockRepo.isLockRequired(),
                                isAuthenticated = authRepo.isAuthenticated,
                                hasResolvedUser = authRepo.resolvedUniqueId != null,
                                currentRoute = navController.currentDestination?.route,
                            )
                        ) {
                            logI("MainViewController", "Chat deep-link dropped — App-Lock is gating")
                            consumeChatDeepLink()
                            return@collect
                        }
                        // Use resolvedUniqueId (not currentUserId) so we never
                        // query users/{firebaseUid} during the cold-start race
                        // before identity resolution completes.
                        val currentUserId = authRepo.resolvedUniqueId
                        if (currentUserId.isNullOrEmpty()) {
                            logW(
                                "MainViewController",
                                "Push deep-link dropped — identity not yet resolved or signed out",
                            )
                            consumeChatDeepLink()
                            return@collect
                        }
                        val targetId = if (link.isGroup) link.conversationId else link.otherUserId
                        val userRepo = koin.get<UserRepository>()
                        val pmRepo = koin.get<PrivateMessageRepository>()
                        val authzOk =
                            verifyPushNavigation(
                                currentUserId = currentUserId,
                                targetId = targetId,
                                isGroup = link.isGroup,
                                fetchBlockedUserIds = { userRepo.getBlockedUserIds(it) },
                                fetchConversation = { pmRepo.getConversation(it) },
                            )
                        if (!authzOk) {
                            consumeChatDeepLink()
                            return@collect
                        }
                        val route =
                            if (link.isGroup) {
                                Screen.GroupChat.createRoute(link.conversationId)
                            } else {
                                Screen.PrivateChat.createRoute(link.otherUserId)
                            }
                        navController.navigate(route)
                        consumeChatDeepLink()
                    }
                }

                // Foreground token-sync trigger lives in AppDelegate (Swift) — it
                // observes UIApplication.didBecomeActiveNotification and calls
                // `IosPushBridgeKt.trySyncFcmTokenForCurrentUser()`. We do NOT
                // duplicate that here; a one-shot LaunchedEffect would race with
                // FCM's async token delivery and miss the registration.

                // SHY-0187: shared launch resolver — the SAME decision Android's
                // MainActivity makes, killing the platform asymmetry (this used to
                // hardcode Sign-In: no silent restore AND no App-Lock gate on iOS).
                // SHY-0143 — the ban gate must resolve BEFORE the start
                // destination, on iOS exactly as on Android.
                //
                // Honest deviation from the story's Performance AC: on Android
                // the ban check joins an EXISTING pre-routing phase (emulator
                // gate + version/health checks), so it adds no blocking leg.
                // iOS has no such phase — it routed synchronously — so here the
                // check does introduce one. That is the right trade: the
                // alternative is to render Main first and bounce to the ban
                // afterwards, which is exactly the window in which a
                // cohort-scoped read could fire, and a banned user would see
                // the room list before being stopped.
                var coldStartBan by remember { mutableStateOf(BanState()) }
                val startDestination by
                    produceState<String?>(initialValue = null) {
                        val koin = KoinPlatformTools.defaultContext().get()
                        val authRepo = koin.get<AuthRepository>()
                        val appLockRepo = koin.get<AppLockRepository>()
                        val deviceRepo = koin.get<DeviceRepository>()
                        val deviceId = koin.get<String>(named("deviceId"))

                        // SHY-0143 — put the REAL uniqueId in place before the
                        // routing decision, identically to Android.
                        //
                        // `currentUserId` falls back to the raw Firebase UID
                        // until `resolvedUniqueId` is set, and nothing on the
                        // cold-start route to Main sets it — `AuthViewModel.init`
                        // is the only code that does, and no AuthViewModel is
                        // constructed on that route. The deep-link handler above
                        // already refuses to trust `currentUserId` for exactly
                        // this reason; the routing decision now does too.
                        //
                        // This matters more on iOS than on Android: the Keychain
                        // SURVIVES app deletion, so a reinstall can inherit the
                        // previous account's stored credential. The cache is
                        // keyed on the live Firebase uid and refuses a record
                        // belonging to anyone else.
                        val sessionCache = koin.get<SessionCache>()
                        val cached = sessionCache.read(authRepo.currentFirebaseUid)
                        if (cached != null) {
                            authRepo.resolvedUniqueId = cached.uniqueId
                            authRepo.resolvedCohort = cached.cohort
                            logI("MainViewController", "Cold-start identity restored from cache (cohort=${cached.cohort})")
                        } else {
                            logI("MainViewController", "Cold-start identity cache miss — resolve-then-route fallback")
                        }

                        // SHY-0143 — the same ColdStartSequencer Android runs,
                        // so the two platforms cannot drift on the ORDER of the
                        // startup gates any more than they can on the routing
                        // decision.
                        //
                        // `startCohortScopedReads` is a no-op because in Compose
                        // that event IS the nav graph mounting, and the graph
                        // below does not mount until this produceState yields a
                        // non-null route — which happens after `run()` returns.
                        val sequencer =
                            ColdStartSequencer(
                                // Lenient on a transient failure, matching Android
                                // and the behaviour AuthViewModelBanTest pins: a
                                // real ban is authoritative, an unreachable ban
                                // service is not evidence of one.
                                checkBans = {
                                    when (val banResult = deviceRepo.checkBanStatus(deviceId)) {
                                        is Resource.Success -> banResult.data.toBanState()
                                        else -> BanState()
                                    }
                                },
                                // A restored session's token carries LAST
                                // session's cohort claim. Rendering a
                                // cohort-scoped room list on it is the
                                // SHY-0132/0137 cross-cohort leak.
                                refreshToken = { authRepo.refreshIdToken() is Resource.Success },
                                startCohortScopedReads = {},
                                signOut = { authRepo.signOut() },
                                launchState = {
                                    LaunchState(
                                        hasStoredCredential = appLockRepo.hasCredential,
                                        isAppLockEnabled = appLockRepo.isAppLockEnabled,
                                        isLockRequired = appLockRepo.isLockRequired(),
                                        isAuthenticated = authRepo.isAuthenticated,
                                        hasResolvedUser = authRepo.resolvedUniqueId != null,
                                    )
                                },
                            )
                        val destination = sequencer.run()
                        coldStartBan = sequencer.lastBan
                        logI(
                            "MainViewController",
                            "Cold-launch destination: ${destination.route} " +
                                "(lockGated=${destination == Screen.Lock}, " +
                                "banned=${sequencer.lastBan.deviceBanned || sequencer.lastBan.networkBanned})",
                        )
                        value = destination.route
                    }

                // Nothing renders until the gate answers, so there is no frame
                // in which content exists for a banned or stale-cohort session.
                startDestination?.let { route ->
                    SharedNavGraph(
                        navController = navController,
                        startDestination = route,
                        onSignOut = { navController.navigate(Screen.SignIn.route) { popUpTo(0) } },
                        coldStartBan = coldStartBan,
                        platformCallbacks = platformCallbacks,
                        platformScreens = platformScreens,
                    )
                }
            }
        } // close PreviewWatermark
    }
}
