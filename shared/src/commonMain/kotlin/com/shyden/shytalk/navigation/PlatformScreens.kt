package com.shyden.shytalk.navigation

import androidx.compose.runtime.Composable

// Parameters for platform-specific screens injected into the shared NavGraph.
// Instead of expect/actual composables (which would require moving Android-specific
// screens and their heavy dependencies into shared/androidMain), the NavGraph receives
// these screens as composable lambdas. Each platform provides its own implementation.

/** Parameters for the sign-in screen. */
data class SignInScreenParams(
    val pendingEmailLink: String? = null,
    val onEmailLinkConsumed: () -> Unit = {},
    val onNavigateToEmail: () -> Unit = {},
    val onAuthSuccess: (hasProfile: Boolean, hasDOB: Boolean, needsLegalAcceptance: Boolean) -> Unit,
)

/** Parameters for the app settings screen. */
data class AppSettingsScreenParams(
    val onNavigateBack: () -> Unit,
    val onNavigateToPrivacyPolicy: () -> Unit,
    val onNavigateToCommunityStandards: () -> Unit = {},
    val onNavigateToTermsAndConditions: () -> Unit = {},
    val onNavigateToCyberBullyingPolicy: () -> Unit = {},
    val onSignOut: () -> Unit,
)

/** Parameters for the warning screen. */
data class WarningScreenParams(
    val reason: String?,
    val onAccept: () -> Unit,
    val onViewCommunityStandards: () -> Unit,
    // SHY-0097: acknowledge is server-authorized + awaited; these surface the
    // in-flight (disabled button) and failure (error text) states.
    val isAcknowledging: Boolean = false,
    val acknowledgeError: String? = null,
)

/** Parameters for the profile screen. */
data class ProfileScreenParams(
    val userId: String? = null,
    val showBackButton: Boolean = true,
    val onNavigateBack: () -> Unit = {},
    val onNavigateToUserProfile: ((String) -> Unit)? = null,
    val onNavigateToFollowList: ((String, String) -> Unit)? = null,
    val onNavigateToSettings: (() -> Unit)? = null,
    val onNavigateToRoom: ((String) -> Unit)? = null,
    val onNavigateToChat: ((String) -> Unit)? = null,
    val onNavigateToWallet: (() -> Unit)? = null,
    val modifier: androidx.compose.ui.Modifier = androidx.compose.ui.Modifier,
)

/** Parameters for the room screen. */
data class RoomScreenParams(
    val roomId: String,
    val isBackendDegraded: Boolean = false,
    val onNavigateBack: () -> Unit,
    val onNavigateToUserProfile: (String) -> Unit = {},
    val onNavigateToChat: (String) -> Unit = {},
    val onNavigateToWallet: () -> Unit = {},
    val onNavigateToAgeVerification: () -> Unit = {},
)

/**
 * Container for platform-specific screen composables.
 *
 * Android provides real implementations wrapping the existing screens.
 * iOS provides stub/placeholder implementations for v1.
 */
data class PlatformScreens(
    val signInScreen: @Composable (SignInScreenParams) -> Unit,
    val appSettingsScreen: @Composable (AppSettingsScreenParams) -> Unit,
    val warningScreen: @Composable (WarningScreenParams) -> Unit,
    val profileScreen: @Composable (ProfileScreenParams) -> Unit,
    val roomScreen: @Composable (RoomScreenParams) -> Unit,
)
