package com.shyden.shytalk

import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.window.ComposeUIViewController
import androidx.navigation.compose.rememberNavController
import com.shyden.shytalk.core.util.LanguagePreference
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
import com.shyden.shytalk.ui.theme.ShyTalkTheme

@Suppress("ktlint:standard:function-naming")
fun MainViewController() = ComposeUIViewController { IosApp() }

@Composable
private fun IosApp() {
    var legalAccepted by remember {
        mutableStateOf(LanguagePreference.getAcceptedLegalVersion() >= CURRENT_LEGAL_VERSION)
    }
    var viewingLegalDoc by remember { mutableStateOf<String?>(null) }

    ShyTalkTheme(darkTheme = true) {
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

            SharedNavGraph(
                navController = navController,
                startDestination = Screen.SignIn.route,
                onSignOut = { navController.navigate(Screen.SignIn.route) { popUpTo(0) } },
                platformCallbacks = platformCallbacks,
                platformScreens = platformScreens,
            )
        }
    }
}
