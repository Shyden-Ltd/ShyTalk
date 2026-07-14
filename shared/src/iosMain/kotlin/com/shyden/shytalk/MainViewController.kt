package com.shyden.shytalk

import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.window.ComposeUIViewController
import androidx.navigation.compose.rememberNavController
import com.shyden.shytalk.core.PreviewWatermark
import com.shyden.shytalk.core.push.chatDeepLinks
import com.shyden.shytalk.core.push.consumeChatDeepLink
import com.shyden.shytalk.core.push.verifyPushNavigation
import com.shyden.shytalk.core.util.LanguagePreference
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.repository.AppLockRepository
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.feature.legal.CURRENT_LEGAL_VERSION
import com.shyden.shytalk.feature.legal.CommunityStandardsScreen
import com.shyden.shytalk.feature.legal.CyberBullyingPolicyScreen
import com.shyden.shytalk.feature.legal.LegalAcceptanceScreen
import com.shyden.shytalk.feature.legal.TermsAndConditionsScreen
import com.shyden.shytalk.feature.privacy.PrivacyPolicyScreen
import com.shyden.shytalk.navigation.IosPlatformNavCallbacks
import com.shyden.shytalk.navigation.Screen
import com.shyden.shytalk.navigation.SharedNavGraph
import com.shyden.shytalk.navigation.createIosPlatformScreens
import com.shyden.shytalk.navigation.resolveLaunchDestination
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import kotlinx.coroutines.flow.filterNotNull
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
                val startDestination =
                    remember {
                        val koin = KoinPlatformTools.defaultContext().get()
                        val authRepo = koin.get<AuthRepository>()
                        val appLockRepo = koin.get<AppLockRepository>()
                        val destination =
                            resolveLaunchDestination(
                                hasStoredCredential = appLockRepo.hasCredential,
                                isAppLockEnabled = appLockRepo.isAppLockEnabled,
                                isLockRequired = appLockRepo.isLockRequired(),
                                isAuthenticated = authRepo.isAuthenticated,
                                hasResolvedUser = authRepo.currentUserId != null,
                            )
                        logI(
                            "MainViewController",
                            "Cold-launch destination: ${destination.route} " +
                                "(lockGated=${destination == Screen.Lock})",
                        )
                        destination.route
                    }

                SharedNavGraph(
                    navController = navController,
                    startDestination = startDestination,
                    onSignOut = { navController.navigate(Screen.SignIn.route) { popUpTo(0) } },
                    platformCallbacks = platformCallbacks,
                    platformScreens = platformScreens,
                )
            }
        } // close PreviewWatermark
    }
}
