package com.shyden.shytalk.navigation

import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.collectAsState
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.rememberCoroutineScope
import androidx.compose.runtime.saveable.rememberSaveable
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.navigation.NavController
import androidx.navigation.NavHostController
import androidx.navigation.NavType
import androidx.navigation.compose.NavHost
import androidx.navigation.compose.composable
import androidx.navigation.navArgument
import com.shyden.shytalk.core.BuildVariant
import com.shyden.shytalk.core.QaContext
import com.shyden.shytalk.core.push.SignOutCoordinator
import com.shyden.shytalk.core.room.RoomLifecycleManager
import com.shyden.shytalk.core.ui.PlatformWebView
import com.shyden.shytalk.core.util.BiometricAuth
import com.shyden.shytalk.core.util.COHORT_MINOR
import com.shyden.shytalk.core.util.LanguagePreference
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.remote.VoiceService
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.feature.ageverification.AgeVerificationSubmitScreen
import com.shyden.shytalk.feature.auth.EmailOtpScreen
import com.shyden.shytalk.feature.auth.PinSetupScreen
import com.shyden.shytalk.feature.daily.DailyRewardCelebrationDialog
import com.shyden.shytalk.feature.daily.DailyRewardDialog
import com.shyden.shytalk.feature.daily.DailyRewardViewModel
import com.shyden.shytalk.feature.legal.CURRENT_LEGAL_VERSION
import com.shyden.shytalk.feature.legal.CommunityStandardsScreen
import com.shyden.shytalk.feature.legal.CyberBullyingPolicyScreen
import com.shyden.shytalk.feature.legal.LegalAcceptanceScreen
import com.shyden.shytalk.feature.legal.TermsAndConditionsScreen
import com.shyden.shytalk.feature.main.MainScreen
import com.shyden.shytalk.feature.messaging.ConversationListScreen
import com.shyden.shytalk.feature.messaging.ConversationListViewModel
import com.shyden.shytalk.feature.messaging.GroupSetupScreen
import com.shyden.shytalk.feature.messaging.GroupSetupViewModel
import com.shyden.shytalk.feature.messaging.NewMessageScreen
import com.shyden.shytalk.feature.messaging.PrivateChatScreen
import com.shyden.shytalk.feature.messaging.PrivateChatViewModel
import com.shyden.shytalk.feature.privacy.PrivacyPolicyScreen
import com.shyden.shytalk.feature.profile.FollowListScreen
import com.shyden.shytalk.feature.profile.GiftWallScreen
import com.shyden.shytalk.feature.profile.GiftWallViewModel
import com.shyden.shytalk.feature.profile.ProfileSetupScreen
import com.shyden.shytalk.feature.profile.RequiredDOBScreen
import com.shyden.shytalk.feature.settings.SecuritySettingsScreen
import com.shyden.shytalk.feature.shop.TransactionHistoryScreen
import com.shyden.shytalk.feature.shop.TransactionHistoryViewModel
import com.shyden.shytalk.feature.shop.WalletScreen
import com.shyden.shytalk.feature.shop.WalletViewModel
import com.shyden.shytalk.feature.support.SupportPage
import com.shyden.shytalk.feature.support.SupportSource
import com.shyden.shytalk.feature.suspension.BanScreen
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.back
import com.shyden.shytalk.resources.warning_acknowledge_failed
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject

private fun NavController.safePopBackStack(): Boolean =
    if (previousBackStackEntry != null) {
        popBackStack()
    } else {
        false
    }

/**
 * Shared navigation graph used by both Android and iOS.
 *
 * Platform-specific behaviors (FCM, permissions, image picking, billing, sign-in UI)
 * are injected via [platformCallbacks] and [platformScreens].
 */
@Composable
fun SharedNavGraph(
    navController: NavHostController,
    startDestination: String,
    isBackendDegraded: Boolean = false,
    pendingEmailLink: String? = null,
    onEmailLinkConsumed: () -> Unit = {},
    onSignOut: () -> Unit,
    /**
     * SHY-0500 — non-null when the background cold-start confirmation found the
     * stored session dead, so the sign-in screen can say why the person is here
     * rather than leaving them to guess.
     */
    launchRedirect: LaunchRedirectReason? = null,
    /**
     * SHY-0143 — the ban facts behind a [Screen.BanDevice] / [Screen.BanNetwork]
     * start destination. Defaulted so existing callers are unaffected: an
     * unbanned launch never routes to either screen, so the default is never
     * rendered.
     */
    coldStartBan: BanState = BanState(),
    platformCallbacks: PlatformNavCallbacks,
    platformScreens: PlatformScreens,
) {
    val activeRoomManager: RoomLifecycleManager = koinInject()
    val authRepository: AuthRepository = koinInject()
    var currentUserId by remember { mutableStateOf(authRepository.resolvedUniqueId) }

    // Re-sync after navigation (e.g., fresh sign-in updates currentUserId from null)
    LaunchedEffect(Unit) {
        navController.currentBackStackEntryFlow.collect { entry ->
            currentUserId = authRepository.resolvedUniqueId
            if (BuildVariant.isPreviewBuild) {
                // Feed the preview watermark's route line (SHY-0205).
                // Route PATTERNS only (`rooms/{roomId}`), never filled-in
                // arguments — a room id or user id in the watermark would
                // leak identifiers into shared screenshots.
                QaContext.setCurrentRoute(entry.destination.route)
            }
        }
    }

    // Real-time suspension + warning listener
    val uid = currentUserId
    val userRepository: UserRepository = koinInject()
    // SHY-0459: the caller's own cohort, so the app stops offering a minor
    // controls the server will refuse. Fed by the SAME live listener as the
    // suspension flags below, so an aged-up account or an admin override takes
    // effect without a reinstall. Starts minor — unknown is the restrictive
    // answer everywhere else cohort is resolved.
    var ownCohort by remember { mutableStateOf(COHORT_MINOR) }
    var ownCohortOverride by remember { mutableStateOf<String?>(null) }
    // SHY-0143 — `currentUserId` above is now `resolvedUniqueId`, NOT the
    // `resolvedUniqueId ?: firebaseUid` fallback. That fallback is the whole
    // hazard: on a cache miss it made this subscribe to `users/<firebaseUid>`,
    // a document that does not exist (SHY-0139).
    //
    // An earlier attempt gated on a `cohortVerified` flag from the cold-start
    // sequencer. That was the wrong property AND a one-shot snapshot: the
    // sequencer runs once per process and returns early for Lock and Sign-In,
    // so after a PIN unlock or a normal sign-in the flag stayed false and this
    // listener — the ONLY real-time suspension and warning listener in the app
    // — never subscribed at all. SHY-0024's AC pins that it must.
    //
    // Reading one's OWN user document is not a cross-cohort read, so the
    // cohort claim was never what gated it. Knowing the correct key is.
    if (uid != null) {
        LaunchedEffect(uid) {
            userRepository.observeUserFlags(uid).collect { flags ->
                ownCohort = flags.cohort
                ownCohortOverride = flags.cohortOverride
                if (flags.isSuspended) {
                    val endDate = flags.suspensionEndDate
                    val isActive = endDate == null || endDate > currentTimeMillis()
                    if (isActive) {
                        onSignOut()
                        navController.navigate(Screen.SignIn.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    }
                }
                if (flags.hasActiveWarning) {
                    val currentRoute = navController.currentDestination?.route
                    if (currentRoute != Screen.Warning.route) {
                        navController.navigate(Screen.Warning.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    }
                }
            }
        }
    }

    fun navigateToRoom(roomId: String) {
        val currentRoomId = activeRoomManager.activeRoomId.value
        if (currentRoomId == roomId) {
            navController.popBackStack(Screen.Room.createRoute(roomId), false)
        } else {
            navController.navigate(Screen.Room.createRoute(roomId)) {
                popUpTo(Screen.Main.route) { inclusive = false }
            }
        }
    }

    // SHY-0187: re-interpose the App-Lock over post-auth content when the
    // lock timeout expires in the background.
    AppLockResumeGate(navController)

    Box(modifier = Modifier.fillMaxSize()) {
        // SHY-0143 — hoisted above the NavHost because the builder lambda is
        // not a @Composable context. Owned here rather than taken from
        // `onSignOut`: a device or network ban follows the hardware or the IP,
        // not the account, so signing out must clear the session and leave the
        // user exactly where they are. iOS proved a caller-supplied lambda
        // cannot be trusted with that — it passed one that navigated away.
        val banSignOutScope = rememberCoroutineScope()
        // SHY-0494: orders "release the push identifier" before "tear down
        // auth", with a bounded wait so a dead network cannot trap somebody in
        // the app. Unit-tested in SignOutCoordinatorTest.
        val signOutCoordinator = remember { SignOutCoordinator() }
        val signOutAndStay: () -> Unit =
            remember(authRepository, banSignOutScope) {
                {
                    banSignOutScope.launch {
                        // `rememberCoroutineScope()` carries no
                        // CoroutineExceptionHandler, and `signOut()` reaches the
                        // Keychain and Firebase — either can throw. Android's
                        // equivalent guards; this one did not, so an uncaught
                        // throw here crashed the app on a ban screen. Every
                        // other sign-out call site in the codebase guards too.
                        try {
                            authRepository.signOut()
                        } catch (e: CancellationException) {
                            throw e
                        } catch (e: Exception) {
                            logW("SharedNavGraph", "ban-screen sign-out failed: ${e.message}")
                        }
                    }
                }
            }

        NavHost(
            navController = navController,
            startDestination = startDestination,
        ) {
            // ── Auth ──

            composable(Screen.Lock.route) {
                com.shyden.shytalk.feature.auth.LockScreen(
                    onUnlocked = {
                        // Warm re-lock (Lock pushed over content) → return to that
                        // content; cold launch (Lock is the stack root) → to Main
                        // with Lock removed so back cannot re-enter it.
                        if (navController.previousBackStackEntry != null) {
                            navController.safePopBackStack()
                        } else {
                            navController.navigate(Screen.Main.route) {
                                popUpTo(Screen.Lock.route) { inclusive = true }
                            }
                        }
                    },
                    onReauthRequired = {
                        // Session unrecoverable — full re-auth, nothing beneath kept.
                        navController.navigate(Screen.SignIn.route) {
                            popUpTo(0) { inclusive = true }
                        }
                    },
                )
            }

            // SHY-0143 — ban destinations reachable WITHOUT sign-in.
            //
            // The ban UI already existed, but only inside SignInScreen, off
            // AuthUiState.isDeviceBanned/isNetworkBanned. SHY-0187's optimistic
            // cold start routes a restored session straight to Main, so that
            // surface became unreachable exactly when a banned user returns —
            // which is why hoisting the CHECK alone would not have closed the
            // gap. These give the check somewhere to land.
            //
            // Terminal by construction: they are the start destination with an
            // empty back stack, so Back leaves the app rather than revealing
            // content beneath. Nothing here navigates onward — a device or
            // network ban is not resolved by signing out (it follows the
            // hardware or the IP/subnet/ASN, not the account), so signing out
            // clears the session and the user stays exactly here.
            //
            // These deliberately do NOT use the graph's `onSignOut` parameter.
            // That comment above used to describe an intention a caller-supplied
            // lambda could not enforce, and iOS duly passed one that navigated
            // to Sign-In without signing out — so a banned iPhone user tapping
            // Sign-out reached the login screen with their session intact,
            // which is the one destination the story says a ban must never
            // reach. Owning the handler here makes the contract structural:
            // there is no lambda for a caller to get wrong.
            composable(Screen.BanDevice.route) {
                BanScreen(
                    banType = "device",
                    reason = coldStartBan.reason,
                    expiresAt = coldStartBan.expiresAt,
                    onSignOut = signOutAndStay,
                )
            }

            composable(Screen.BanNetwork.route) {
                BanScreen(
                    banType = "network",
                    reason = coldStartBan.reason,
                    expiresAt = coldStartBan.expiresAt,
                    onSignOut = signOutAndStay,
                )
            }

            composable(Screen.SignIn.route) {
                platformScreens.signInScreen(
                    SignInScreenParams(
                        sessionExpired = launchRedirect == LaunchRedirectReason.SESSION_EXPIRED,
                        pendingEmailLink = pendingEmailLink,
                        onEmailLinkConsumed = onEmailLinkConsumed,
                        onNavigateToEmail = {
                            navController.navigate(Screen.EmailSignIn.route)
                        },
                        onAuthSuccess = { hasProfile, hasDOB, needsLegalAcceptance ->
                            when {
                                !hasProfile ->
                                    navController.navigate(Screen.ProfileSetup.route) {
                                        popUpTo(Screen.SignIn.route) { inclusive = true }
                                    }

                                !hasDOB ->
                                    navController.navigate(Screen.RequiredDOB.route) {
                                        popUpTo(Screen.SignIn.route) { inclusive = true }
                                    }

                                needsLegalAcceptance -> {
                                    navController.navigate(Screen.Main.route) {
                                        popUpTo(Screen.SignIn.route) { inclusive = true }
                                    }
                                    navController.navigate(Screen.LegalAcceptance.route)
                                }

                                else ->
                                    navController.navigate(Screen.Main.route) {
                                        popUpTo(Screen.SignIn.route) { inclusive = true }
                                    }
                            }
                        },
                    ),
                )
            }

            composable(Screen.EmailSignIn.route) {
                val authViewModel: com.shyden.shytalk.feature.auth.AuthViewModel =
                    org.koin.compose.viewmodel
                        .koinViewModel()
                EmailOtpScreen(
                    onNavigateBack = { navController.safePopBackStack() },
                    onAuthSuccess = { customToken ->
                        authViewModel.signInWithCustomToken(customToken)
                    },
                )
            }

            composable(Screen.ProfileSetup.route) {
                ProfileSetupScreen(
                    onProfileComplete = {
                        navController.navigate(Screen.Main.route) {
                            popUpTo(Screen.ProfileSetup.route) { inclusive = true }
                        }
                    },
                )
            }

            composable(Screen.RequiredDOB.route) {
                RequiredDOBScreen(
                    onComplete = {
                        navController.navigate(Screen.Main.route) {
                            popUpTo(Screen.RequiredDOB.route) { inclusive = true }
                        }
                    },
                )
            }

            // ── Age Verification submit (PR 9) ──
            // Reached from the AgeRestrictionDialog "Verify now" CTA
            // when the user is 18+ but unverified. The screen handles
            // its own back/done navigation via onClose.
            composable(Screen.AgeVerificationSubmit.route) {
                AgeVerificationSubmitScreen(
                    onClose = { navController.popBackStack() },
                )
            }

            // ── Main ──

            composable(Screen.Main.route) {
                // Platform-specific: save FCM token, start sync service, request permissions
                LaunchedEffect(Unit) {
                    val userId = authRepository.currentUserId ?: return@LaunchedEffect
                    platformCallbacks.saveFcmToken(userId)
                }
                LaunchedEffect(Unit) {
                    platformCallbacks.startMessageSyncService()
                }
                LaunchedEffect(Unit) {
                    platformCallbacks.requestPermissions()
                }

                val conversationListViewModel: ConversationListViewModel = koinInject()
                val dailyRewardViewModel: DailyRewardViewModel =
                    org.koin.compose.viewmodel
                        .koinViewModel()
                var showDailyRewardDialog by rememberSaveable { mutableStateOf(true) }
                val dailyRewardState by dailyRewardViewModel.uiState.collectAsState()

                LaunchedEffect(Unit) {
                    val userId = authRepository.currentUserId ?: return@LaunchedEffect
                    when (val result = userRepository.getUser(userId)) {
                        is Resource.Success -> dailyRewardViewModel.checkAndShowDialog(result.data)
                        else -> {}
                    }
                }

                if (showDailyRewardDialog && dailyRewardState.showDialog && !dailyRewardState.hasClaimedToday) {
                    DailyRewardDialog(
                        viewModel = dailyRewardViewModel,
                        onDismiss = { showDailyRewardDialog = false },
                    )
                }

                if (dailyRewardState.showCelebration) {
                    DailyRewardCelebrationDialog(
                        viewModel = dailyRewardViewModel,
                        onDismiss = { showDailyRewardDialog = false },
                    )
                }

                val voiceService: VoiceService = koinInject()

                MainScreen(
                    isBackendDegraded = isBackendDegraded,
                    cohort = ownCohort,
                    cohortOverride = ownCohortOverride,
                    onNavigateToRoom = { roomId -> navigateToRoom(roomId) },
                    onPrewarmRoom = { room ->
                        val userId = authRepository.currentUserId
                        if (userId != null && room.voiceRoomName.isNotEmpty()) {
                            voiceService.prewarmToken(room.voiceRoomName, userId)
                        }
                    },
                    _onNavigateToUserProfile = { userId ->
                        navController.navigate(Screen.UserProfile.createRoute(userId))
                    },
                    _onNavigateToFollowList = { userId, tab ->
                        navController.navigate(Screen.FollowList.createRoute(userId, tab))
                    },
                    onNavigateToSettings = {
                        navController.navigate(Screen.Settings.route)
                    },
                    onNavigateToNewMessage = {
                        navController.navigate(Screen.NewMessage.route)
                    },
                    onNavigateToWallet = {
                        navController.navigate(Screen.Wallet.route)
                    },
                    onNavigateToUrl = { url ->
                        navController.navigate(
                            Screen.Browser.createRoute(platformCallbacks.encodeUrl(url)),
                        )
                    },
                    messagesContent = { modifier ->
                        ConversationListScreen(
                            onNavigateToChat = { otherUserId ->
                                navController.navigate(Screen.PrivateChat.createRoute(otherUserId))
                            },
                            onNavigateToGroupChat = { conversationId ->
                                navController.navigate(Screen.GroupChat.createRoute(conversationId))
                            },
                            modifier = modifier,
                        )
                    },
                    totalUnreadCount =
                        conversationListViewModel.uiState
                            .collectAsState()
                            .value.totalUnreadCount,
                    profileContent = { modifier ->
                        platformScreens.profileScreen(
                            ProfileScreenParams(
                                userId = null,
                                showBackButton = false,
                                onNavigateBack = {},
                                onNavigateToUserProfile = { userId ->
                                    navController.navigate(Screen.UserProfile.createRoute(userId))
                                },
                                onNavigateToFollowList = { userId, tab ->
                                    navController.navigate(Screen.FollowList.createRoute(userId, tab))
                                },
                                onNavigateToRoom = { roomId -> navigateToRoom(roomId) },
                                onNavigateToChat = { otherUserId ->
                                    navController.navigate(Screen.PrivateChat.createRoute(otherUserId))
                                },
                                onNavigateToWallet = {
                                    navController.navigate(Screen.Wallet.route)
                                },
                                modifier = modifier,
                            ),
                        )
                    },
                )
            }

            // ── Room ──

            composable(
                route = Screen.Room.route,
                arguments = listOf(navArgument("roomId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val roomId = backStackEntry.savedStateHandle.get<String>("roomId") ?: return@composable
                platformScreens.roomScreen(
                    RoomScreenParams(
                        roomId = roomId,
                        isBackendDegraded = isBackendDegraded,
                        onNavigateBack = { navController.safePopBackStack() },
                        onNavigateToUserProfile = { userId ->
                            navController.navigate(Screen.UserProfile.createRoute(userId))
                        },
                        onNavigateToChat = { otherUserId ->
                            navController.navigate(Screen.PrivateChat.createRoute(otherUserId))
                        },
                        onNavigateToWallet = {
                            navController.navigate(Screen.Wallet.route)
                        },
                        onNavigateToAgeVerification = {
                            navController.navigate(Screen.AgeVerificationSubmit.route)
                        },
                        onNavigateToSupport = { source ->
                            navController.navigate(Screen.Support.createRoute(source.wireValue))
                        },
                    ),
                )
            }

            // ── Profile ──

            composable(
                route = Screen.UserProfile.route,
                arguments = listOf(navArgument("userId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val userId = backStackEntry.savedStateHandle.get<String>("userId") ?: return@composable
                platformScreens.profileScreen(
                    ProfileScreenParams(
                        userId = userId,
                        onNavigateBack = { navController.safePopBackStack() },
                        onNavigateToUserProfile = { uid ->
                            navController.navigate(Screen.UserProfile.createRoute(uid))
                        },
                        onNavigateToFollowList = { uid, tab ->
                            navController.navigate(Screen.FollowList.createRoute(uid, tab))
                        },
                        onNavigateToRoom = { roomId -> navigateToRoom(roomId) },
                        onNavigateToChat = { otherUserId ->
                            navController.navigate(Screen.PrivateChat.createRoute(otherUserId))
                        },
                        onNavigateToWallet = {
                            navController.navigate(Screen.Wallet.route)
                        },
                    ),
                )
            }

            // ── Messaging ──

            composable(
                route = Screen.PrivateChat.route,
                arguments = listOf(navArgument("otherUserId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val otherUserId = backStackEntry.savedStateHandle.get<String>("otherUserId") ?: return@composable
                val chatViewModel: PrivateChatViewModel =
                    org.koin.compose.viewmodel.koinViewModel(
                        key = otherUserId,
                    ) {
                        org.koin.core.parameter
                            .parametersOf(otherUserId)
                    }

                val activeRoomId by activeRoomManager.activeRoomId.collectAsState()
                val activeRoom by activeRoomManager.activeRoom.collectAsState()

                PrivateChatScreen(
                    otherUserId = otherUserId,
                    onNavigateBack = { navController.safePopBackStack() },
                    onNavigateToUserProfile = { uid ->
                        navController.navigate(Screen.UserProfile.createRoute(uid))
                    },
                    onPickImages = {
                        platformCallbacks.pickImages(10) { bytesList ->
                            chatViewModel.uploadAndSendImages(bytesList)
                        }
                    },
                    onPickStickerImage = {
                        platformCallbacks.pickStickerImage { bytes ->
                            if (bytes != null) {
                                chatViewModel.addStickerFromImage(bytes)
                            }
                        }
                    },
                    onNavigateToRoom = { roomId -> navigateToRoom(roomId) },
                    onNavigateToAgeVerification = {
                        navController.navigate(Screen.AgeVerificationSubmit.route)
                    },
                    onNavigateToSupport = { source ->
                        navController.navigate(Screen.Support.createRoute(source.wireValue))
                    },
                    activeRoomId = activeRoomId,
                    activeRoomName = activeRoom?.name,
                    viewModel = chatViewModel,
                )
            }

            composable(
                route = Screen.FollowList.route,
                arguments =
                    listOf(
                        navArgument("userId") { type = NavType.StringType },
                        navArgument("tab") { type = NavType.StringType },
                    ),
            ) { backStackEntry ->
                val userId = backStackEntry.savedStateHandle.get<String>("userId") ?: return@composable
                val tab = backStackEntry.savedStateHandle.get<String>("tab") ?: "followers"
                FollowListScreen(
                    userId = userId,
                    tab = tab,
                    onNavigateBack = { navController.safePopBackStack() },
                    onNavigateToUserProfile = { uid ->
                        navController.navigate(Screen.UserProfile.createRoute(uid))
                    },
                    onNavigateToSuperShy = { navController.safePopBackStack() },
                )
            }

            // ── Settings ──

            composable(Screen.Settings.route) {
                platformScreens.appSettingsScreen(
                    AppSettingsScreenParams(
                        onNavigateBack = { navController.safePopBackStack() },
                        onNavigateToPrivacyPolicy = {
                            navController.navigate(Screen.PrivacyPolicy.route)
                        },
                        onNavigateToCommunityStandards = {
                            navController.navigate(Screen.CommunityStandards.route)
                        },
                        onNavigateToTermsAndConditions = {
                            navController.navigate(Screen.TermsAndConditions.route)
                        },
                        onNavigateToCyberBullyingPolicy = {
                            navController.navigate(Screen.CyberBullyingPolicy.route)
                        },
                        onNavigateToSecurity = { navController.navigate(Screen.SecuritySettings.route) },
                        onNavigateToSupport = { source ->
                            navController.navigate(Screen.Support.createRoute(source.wireValue))
                        },
                        onSignOut = {
                            val signOutUserId = authRepository.currentUserId
                            // SHY-0494: released on banSignOutScope, which is
                            // remembered at the NavGraph level and therefore
                            // SURVIVES this navigation. The settings screen's own
                            // scope does not — that is what cancelled the release
                            // before it could reach the backend.
                            banSignOutScope.launch {
                                signOutCoordinator.signOut(
                                    userId = signOutUserId,
                                    releaseIdentifier = { platformCallbacks.removeFcmToken(it) },
                                ) {
                                    platformCallbacks.stopMessageSyncService()
                                    onSignOut()
                                }
                                navController.navigate(Screen.SignIn.route) {
                                    popUpTo(Screen.Main.route) { inclusive = true }
                                }
                            }
                        },
                    ),
                )
            }

            composable(Screen.SecuritySettings.route) {
                SecuritySettingsScreen(
                    appLockRepository = koinInject(),
                    biometricAvailable = koinInject<BiometricAuth>().isAvailable(),
                    onNavigateBack = { navController.safePopBackStack() },
                    onResetPin = { navController.navigate(Screen.PinSetup.route) },
                )
            }

            composable(Screen.PinSetup.route) {
                PinSetupScreen(
                    onCompleted = { navController.safePopBackStack() },
                    biometricAvailable = koinInject<BiometricAuth>().isAvailable(),
                )
            }

            // ── Legal ──

            composable(Screen.PrivacyPolicy.route) {
                PrivacyPolicyScreen(
                    onAccept = { navController.safePopBackStack() },
                    onDecline = { navController.safePopBackStack() },
                    onNavigateBack = { navController.safePopBackStack() },
                    showActions = false,
                )
            }

            composable(
                route = Screen.Support.route,
                arguments = listOf(navArgument("source") { type = NavType.StringType }),
            ) { backStackEntry ->
                // An unrecognised source still opens support, categorised
                // generically. Being unable to reach help is worse than one
                // ticket labelled Other.
                val source =
                    SupportSource.fromWire(backStackEntry.savedStateHandle.get<String>("source"))
                SupportPage(
                    viewModel =
                        org.koin.compose.viewmodel.koinViewModel {
                            org.koin.core.parameter
                                .parametersOf(source.category, source.context())
                        },
                    onBack = { navController.safePopBackStack() },
                )
            }

            composable(Screen.CommunityStandards.route) {
                CommunityStandardsScreen(
                    onNavigateBack = { navController.safePopBackStack() },
                )
            }

            composable(Screen.TermsAndConditions.route) {
                TermsAndConditionsScreen(
                    onNavigateBack = { navController.safePopBackStack() },
                )
            }

            composable(Screen.CyberBullyingPolicy.route) {
                CyberBullyingPolicyScreen(
                    onNavigateBack = { navController.safePopBackStack() },
                )
            }

            composable(Screen.LegalAcceptance.route) {
                val legalUserRepository: UserRepository = koinInject()
                val legalScope = rememberCoroutineScope()

                LegalAcceptanceScreen(
                    onAccept = {
                        legalScope.launch {
                            val userId = authRepository.currentUserId ?: return@launch
                            val result =
                                legalUserRepository.updateProfile(
                                    userId,
                                    mapOf(
                                        "acceptedLegalVersion" to CURRENT_LEGAL_VERSION,
                                        "legalAcceptedAt" to currentTimeMillis(),
                                    ),
                                )
                            if (result is Resource.Success) {
                                LanguagePreference.setAcceptedLegalVersion(CURRENT_LEGAL_VERSION)
                                navController.safePopBackStack()
                            }
                        }
                    },
                    onViewPrivacyPolicy = {
                        navController.navigate(Screen.PrivacyPolicy.route)
                    },
                    onViewCommunityStandards = {
                        navController.navigate(Screen.CommunityStandards.route)
                    },
                    onViewTerms = {
                        navController.navigate(Screen.TermsAndConditions.route)
                    },
                    onViewCyberBullyingPolicy = {
                        navController.navigate(Screen.CyberBullyingPolicy.route)
                    },
                )
            }

            // ── Group Chat ──

            composable(
                route = Screen.GroupChat.route,
                arguments = listOf(navArgument("conversationId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val cId = backStackEntry.savedStateHandle.get<String>("conversationId") ?: return@composable
                val groupChatViewModel: PrivateChatViewModel =
                    org.koin.compose.viewmodel.koinViewModel(
                        key = cId,
                    ) {
                        org.koin.core.parameter
                            .parametersOf("", cId)
                    }

                val groupActiveRoomId by activeRoomManager.activeRoomId.collectAsState()
                val groupActiveRoom by activeRoomManager.activeRoom.collectAsState()

                PrivateChatScreen(
                    conversationId = cId,
                    onNavigateBack = { navController.safePopBackStack() },
                    onNavigateToUserProfile = { uid ->
                        navController.navigate(Screen.UserProfile.createRoute(uid))
                    },
                    onPickImages = {
                        platformCallbacks.pickImages(10) { bytesList ->
                            groupChatViewModel.uploadAndSendImages(bytesList)
                        }
                    },
                    onPickStickerImage = {
                        platformCallbacks.pickStickerImage { bytes ->
                            if (bytes != null) {
                                groupChatViewModel.addStickerFromImage(bytes)
                            }
                        }
                    },
                    onNavigateToRoom = { roomId -> navigateToRoom(roomId) },
                    onNavigateToAgeVerification = {
                        navController.navigate(Screen.AgeVerificationSubmit.route)
                    },
                    onNavigateToSupport = { source ->
                        navController.navigate(Screen.Support.createRoute(source.wireValue))
                    },
                    activeRoomId = groupActiveRoomId,
                    activeRoomName = groupActiveRoom?.name,
                    viewModel = groupChatViewModel,
                )
            }

            composable(Screen.NewMessage.route) {
                NewMessageScreen(
                    onNavigateBack = { navController.safePopBackStack() },
                    onNavigateToChat = { otherUserId ->
                        navController.navigate(Screen.PrivateChat.createRoute(otherUserId)) {
                            popUpTo(Screen.NewMessage.route) { inclusive = true }
                        }
                    },
                    onNavigateToGroupSetup = { selectedIds ->
                        navController.navigate(Screen.GroupSetup.createRoute(selectedIds))
                    },
                )
            }

            composable(
                route = Screen.GroupSetup.route,
                arguments = listOf(navArgument("selectedIds") { type = NavType.StringType }),
            ) { backStackEntry ->
                val selectedIds = backStackEntry.savedStateHandle.get<String>("selectedIds") ?: return@composable
                val groupSetupViewModel: GroupSetupViewModel =
                    org.koin.compose.viewmodel.koinViewModel(
                        key = selectedIds,
                    ) {
                        org.koin.core.parameter
                            .parametersOf(selectedIds)
                    }

                GroupSetupScreen(
                    selectedIds = selectedIds,
                    onNavigateBack = { navController.safePopBackStack() },
                    onGroupCreated = { conversationId ->
                        navController.navigate(Screen.GroupChat.createRoute(conversationId)) {
                            popUpTo(Screen.NewMessage.route) { inclusive = true }
                        }
                    },
                    onPickGroupPhoto = {
                        platformCallbacks.pickAndCropPhoto { bytes ->
                            if (bytes != null) {
                                groupSetupViewModel.setGroupPhoto(bytes)
                            }
                        }
                    },
                    viewModel = groupSetupViewModel,
                )
            }

            // ── Wallet ──

            composable(Screen.Wallet.route) {
                val walletViewModel: WalletViewModel =
                    org.koin.compose.viewmodel
                        .koinViewModel()

                WalletScreen(
                    viewModel = walletViewModel,
                    onNavigateBack = { navController.safePopBackStack() },
                    onNavigateToTransactions = { navController.navigate(Screen.Transactions.route) },
                    onPurchasePackage = { pkg ->
                        platformCallbacks.purchasePackage(pkg.productId)
                    },
                    _onPurchaseSubscription = { productId ->
                        platformCallbacks.purchaseSubscription(productId)
                    },
                )
            }

            composable(Screen.Transactions.route) {
                val transactionHistoryViewModel: TransactionHistoryViewModel =
                    org.koin.compose.viewmodel
                        .koinViewModel()
                TransactionHistoryScreen(
                    viewModel = transactionHistoryViewModel,
                    onNavigateBack = { navController.safePopBackStack() },
                )
            }

            composable(
                route = Screen.GiftWall.route,
                arguments = listOf(navArgument("userId") { type = NavType.StringType }),
            ) { backStackEntry ->
                val userId = backStackEntry.savedStateHandle.get<String>("userId") ?: return@composable
                val giftWallViewModel: GiftWallViewModel =
                    org.koin.compose.viewmodel.koinViewModel(
                        key = userId,
                    ) {
                        org.koin.core.parameter
                            .parametersOf(userId)
                    }

                GiftWallScreen(
                    viewModel = giftWallViewModel,
                    onNavigateBack = { navController.safePopBackStack() },
                )
            }

            // ── Browser ──

            composable(
                route = Screen.Browser.route,
                arguments = listOf(navArgument("url") { type = NavType.StringType }),
            ) { backStackEntry ->
                val encodedUrl = backStackEntry.savedStateHandle.get<String>("url") ?: return@composable
                val url = platformCallbacks.decodeUrl(encodedUrl)
                @OptIn(ExperimentalMaterial3Api::class)
                Scaffold(
                    topBar = {
                        TopAppBar(
                            title = { Text("") },
                            navigationIcon = {
                                IconButton(
                                    onClick = { navController.safePopBackStack() },
                                    modifier = Modifier.testTag("browser_backButton"),
                                ) {
                                    Icon(
                                        Icons.AutoMirrored.Filled.ArrowBack,
                                        contentDescription = stringResource(Res.string.back),
                                    )
                                }
                            },
                        )
                    },
                ) { padding ->
                    PlatformWebView(
                        url = url,
                        modifier = Modifier.fillMaxSize().padding(padding),
                    )
                }
            }

            // ── Warning ──

            composable(Screen.Warning.route) {
                val warningUserRepo: UserRepository = koinInject()
                val warningScope = rememberCoroutineScope()

                var warningReason by remember { mutableStateOf<String?>(null) }
                var isAcknowledging by remember { mutableStateOf(false) }
                var acknowledgeError by remember { mutableStateOf<String?>(null) }
                val ackFailedMessage = stringResource(Res.string.warning_acknowledge_failed)
                LaunchedEffect(Unit) {
                    val userId = authRepository.currentUserId ?: return@LaunchedEffect
                    when (val result = warningUserRepo.getWarningReason(userId)) {
                        is Resource.Success -> warningReason = result.data
                        else -> {}
                    }
                }

                platformScreens.warningScreen(
                    WarningScreenParams(
                        reason = warningReason,
                        isAcknowledging = isAcknowledging,
                        acknowledgeError = acknowledgeError,
                        onAccept = {
                            warningScope.launch {
                                // SHY-0097: AWAIT the server result and navigate to
                                // Main ONLY on success. On failure stay on the
                                // warning screen + show the error (retry possible) —
                                // never the old fire-and-forget that navigated
                                // optimistically then got bounced straight back by
                                // the reactive moderation gate (silent failure).
                                isAcknowledging = true
                                acknowledgeError = null
                                acknowledgeWarningAndRoute(
                                    userId = authRepository.currentUserId,
                                    acknowledge = warningUserRepo::acknowledgeWarning,
                                    onSuccess = {
                                        // Reset before navigating: if the navigate is a
                                        // no-op (the reactive gate may have already moved
                                        // us) the composable can linger — don't leave it
                                        // stuck disabled/spinning.
                                        isAcknowledging = false
                                        navController.navigate(Screen.Main.route) {
                                            popUpTo(Screen.Warning.route) { inclusive = true }
                                        }
                                    },
                                    onError = {
                                        acknowledgeError = ackFailedMessage
                                        isAcknowledging = false
                                    },
                                )
                            }
                        },
                        onViewCommunityStandards = {
                            navController.navigate(Screen.CommunityStandards.route)
                        },
                    ),
                )
            }
        }
    }
}
