package com.shyden.shytalk.navigation

import androidx.compose.runtime.Composable

/**
 * iOS-specific NavGraph screen wiring.
 *
 * - SignIn → unified `SignInScreen` (commonMain since Phase 4 of #20)
 * - AppSettings → unified `AppSettingsScreen` (commonMain)
 * - Warning → shared `WarningScreen` (commonMain)
 * - Profile → shared `ProfileScreen` (commonMain)
 * - Room → shared `RoomScreen` (commonMain)
 */
fun createIosPlatformScreens(): PlatformScreens =
    PlatformScreens(
        signInScreen = { params ->
            com.shyden.shytalk.feature.auth.SignInScreen(
                pendingEmailLink = params.pendingEmailLink,
                onEmailLinkConsumed = params.onEmailLinkConsumed,
                onNavigateToEmail = params.onNavigateToEmail,
                onAuthSuccess = params.onAuthSuccess,
            )
        },
        appSettingsScreen = { params ->
            com.shyden.shytalk.feature.settings.AppSettingsScreen(
                onNavigateBack = params.onNavigateBack,
                onNavigateToPrivacyPolicy = params.onNavigateToPrivacyPolicy,
                onNavigateToCommunityStandards = params.onNavigateToCommunityStandards,
                onNavigateToTermsAndConditions = params.onNavigateToTermsAndConditions,
                onNavigateToCyberBullyingPolicy = params.onNavigateToCyberBullyingPolicy,
                onSignOut = params.onSignOut,
            )
        },
        warningScreen = { params -> IosWarningScreen(params) },
        profileScreen = { params ->
            com.shyden.shytalk.feature.profile.ProfileScreen(
                userId = params.userId,
                showBackButton = params.showBackButton,
                onNavigateBack = params.onNavigateBack,
                onNavigateToUserProfile = params.onNavigateToUserProfile,
                onNavigateToFollowList = params.onNavigateToFollowList,
                onNavigateToSettings = params.onNavigateToSettings,
                onNavigateToRoom = params.onNavigateToRoom,
                onNavigateToChat = params.onNavigateToChat,
                onNavigateToWallet = params.onNavigateToWallet,
                modifier = params.modifier,
            )
        },
        roomScreen = { params ->
            com.shyden.shytalk.feature.room.RoomScreen(
                roomId = params.roomId,
                isBackendDegraded = params.isBackendDegraded,
                onNavigateBack = params.onNavigateBack,
                onNavigateToUserProfile = params.onNavigateToUserProfile,
                onNavigateToChat = params.onNavigateToChat,
                onNavigateToWallet = params.onNavigateToWallet,
                onNavigateToAgeVerification = params.onNavigateToAgeVerification,
            )
        },
    )

@Composable
private fun IosWarningScreen(params: WarningScreenParams) {
    com.shyden.shytalk.feature.warning.WarningScreen(
        reason = params.reason,
        onAccept = params.onAccept,
        onViewCommunityStandards = params.onViewCommunityStandards,
        isAcknowledging = params.isAcknowledging,
        acknowledgeError = params.acknowledgeError,
    )
}
