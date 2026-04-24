package com.shyden.shytalk.navigation

import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.height
import androidx.compose.material3.Button
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp

/**
 * iOS placeholder screens for v1.
 *
 * These will be replaced with real iOS implementations:
 * - SignIn → real IosSignInScreen (Google + Apple + Email/OTP)
 * - AppSettings → iOS Settings.app integration
 * - Warning → shared WarningScreen (EmergencyTonePlayer via AVAudioEngine + shared drawable)
 * - Profile → shared ProfileScreen (once moved to commonMain)
 * - Room → shared RoomScreen (once moved to commonMain)
 */
fun createIosPlatformScreens(): PlatformScreens =
    PlatformScreens(
        signInScreen = { params ->
            com.shyden.shytalk.feature.auth
                .IosSignInScreen(params)
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
        profileScreen = { params -> IosProfilePlaceholder(params) },
        roomScreen = { params -> IosRoomPlaceholder(params) },
    )

@Composable
private fun IosWarningScreen(params: WarningScreenParams) {
    com.shyden.shytalk.feature.warning.WarningScreen(
        reason = params.reason,
        onAccept = params.onAccept,
        onViewCommunityStandards = params.onViewCommunityStandards,
    )
}

@Composable
private fun IosProfilePlaceholder(params: ProfileScreenParams) {
    PlaceholderScreen(
        title = "Profile",
        subtitle = if (params.userId != null) "User ${params.userId}" else "Your Profile",
        actionLabel = if (params.showBackButton) "Back" else null,
        actionTag = "ios_profile_backButton",
        onAction = params.onNavigateBack,
    )
}

@Composable
private fun IosRoomPlaceholder(params: RoomScreenParams) {
    PlaceholderScreen(
        title = "Voice Room",
        subtitle = "Room: ${params.roomId}",
        actionLabel = "Leave",
        actionTag = "ios_room_leaveButton",
        onAction = params.onNavigateBack,
    )
}

@Composable
private fun PlaceholderScreen(
    title: String,
    subtitle: String,
    actionLabel: String? = null,
    actionTag: String = "",
    onAction: () -> Unit = {},
) {
    Column(
        modifier = Modifier.fillMaxSize(),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
    ) {
        Text(
            text = title,
            style = MaterialTheme.typography.headlineMedium,
            color = MaterialTheme.colorScheme.primary,
        )
        Spacer(modifier = Modifier.height(8.dp))
        Text(
            text = subtitle,
            style = MaterialTheme.typography.bodyMedium,
            color = MaterialTheme.colorScheme.onSurfaceVariant,
        )
        if (actionLabel != null) {
            Spacer(modifier = Modifier.height(24.dp))
            Button(
                onClick = onAction,
                modifier = Modifier.testTag(actionTag),
            ) {
                Text(actionLabel)
            }
        }
    }
}
