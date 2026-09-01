package com.shyden.shytalk.feature.starting

import androidx.compose.foundation.Image
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Campaign
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.Info
import androidx.compose.material.icons.filled.Warning
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.platform.PlatformSettingsService
import com.shyden.shytalk.core.ui.RemoteImage
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.police_duck
import com.shyden.shytalk.resources.starting_screen_dismiss
import com.shyden.shytalk.resources.starting_screen_police_duck_description
import com.shyden.shytalk.resources.starting_screen_pre_launch_message
import com.shyden.shytalk.resources.starting_screen_pre_launch_title
import org.jetbrains.compose.resources.painterResource
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.koinInject
import com.shyden.shytalk.data.remote.StartingScreen as StartingScreenData

private const val PRE_LAUNCH_GATE_ID = "preLaunchGate"
private const val POLICE_DUCK_IMAGE = "police_duck"

private val WARNING_COLOR = Color(0xFFE74C3C)
private val PROMO_COLOR = Color(0xFF9B59B6)
private val ANNOUNCEMENT_COLOR = Color(0xFF3498DB)
private val INFO_COLOR = Color(0xFF2ECC71)

/**
 * Full-screen starting screen composable.
 *
 * Shows ShyTalk branding, template/image icon, title, message, and
 * optionally a dismiss button. Can have a background image with a
 * dark overlay for text readability.
 */
@Composable
fun StartingScreenComposable(
    screen: StartingScreenData,
    onDismiss: () -> Unit,
    backgroundImagePath: String? = null,
    platformSettings: PlatformSettingsService = koinInject(),
) {
    val templateColor =
        remember(screen.template) {
            when (screen.template) {
                "warning" -> WARNING_COLOR
                "promotional" -> PROMO_COLOR
                "announcement" -> ANNOUNCEMENT_COLOR
                "info" -> INFO_COLOR
                else -> INFO_COLOR
            }
        }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            if (backgroundImagePath != null) {
                RemoteImage(
                    model = backgroundImagePath,
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )
                Box(
                    modifier =
                        Modifier
                            .fillMaxSize()
                            .background(Color.Black.copy(alpha = 0.6f)),
                )
            }

            Column(
                modifier =
                    Modifier
                        .fillMaxSize()
                        .verticalScroll(rememberScrollState())
                        .padding(32.dp),
                horizontalAlignment = Alignment.CenterHorizontally,
                verticalArrangement = Arrangement.Center,
            ) {
                // App icon resolved via PlatformSettingsService — Android returns
                // the launcher icon, iOS returns null (UIImage→Skia conversion is
                // non-trivial and the screen renders without it).
                val appIcon = remember { platformSettings.getAppIcon()?.let(::BitmapPainter) }
                if (appIcon != null) {
                    Image(
                        painter = appIcon,
                        contentDescription = "ShyTalk",
                        modifier = Modifier.size(80.dp),
                    )
                    Spacer(modifier = Modifier.height(8.dp))
                }

                Text(
                    text = "ShyTalk",
                    style = MaterialTheme.typography.headlineLarge,
                    color =
                        if (backgroundImagePath != null) {
                            Color.White
                        } else {
                            MaterialTheme.colorScheme.onBackground
                        },
                    textAlign = TextAlign.Center,
                )

                Spacer(modifier = Modifier.height(32.dp))

                when (screen.imageType) {
                    POLICE_DUCK_IMAGE -> {
                        Image(
                            painter = painterResource(Res.drawable.police_duck),
                            contentDescription = stringResource(Res.string.starting_screen_police_duck_description),
                            modifier = Modifier.size(120.dp),
                        )
                    }

                    else -> {
                        val icon =
                            when (screen.template) {
                                "warning" -> Icons.Default.Warning
                                "promotional" -> Icons.Default.CardGiftcard
                                "announcement" -> Icons.Default.Campaign
                                else -> Icons.Default.Info
                            }
                        Icon(
                            imageVector = icon,
                            contentDescription = null,
                            modifier = Modifier.size(80.dp),
                            tint = templateColor,
                        )
                    }
                }

                Spacer(modifier = Modifier.height(24.dp))

                val displayTitle =
                    if (screen.screenId == PRE_LAUNCH_GATE_ID) {
                        stringResource(Res.string.starting_screen_pre_launch_title)
                    } else {
                        screen.title
                    }
                Text(
                    text = displayTitle,
                    style = MaterialTheme.typography.headlineMedium,
                    textAlign = TextAlign.Center,
                    color =
                        if (backgroundImagePath != null) {
                            Color.White
                        } else {
                            MaterialTheme.colorScheme.onBackground
                        },
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .testTag("startingScreen_title"),
                )

                Spacer(modifier = Modifier.height(12.dp))

                val displayMessage =
                    if (screen.screenId == PRE_LAUNCH_GATE_ID) {
                        stringResource(Res.string.starting_screen_pre_launch_message)
                    } else {
                        screen.message
                    }
                Text(
                    text = displayMessage,
                    style = MaterialTheme.typography.bodyLarge,
                    textAlign = TextAlign.Center,
                    color =
                        if (backgroundImagePath != null) {
                            Color.White.copy(alpha = 0.9f)
                        } else {
                            MaterialTheme.colorScheme.onSurfaceVariant
                        },
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .testTag("startingScreen_message"),
                )

                if (screen.dismissable) {
                    Spacer(modifier = Modifier.height(32.dp))

                    Button(
                        onClick = onDismiss,
                        modifier =
                            Modifier
                                .fillMaxWidth()
                                .height(48.dp)
                                .testTag("startingScreen_dismissButton"),
                        colors =
                            ButtonDefaults.buttonColors(
                                containerColor = templateColor,
                            ),
                    ) {
                        Text(
                            text = stringResource(Res.string.starting_screen_dismiss),
                            style = MaterialTheme.typography.labelLarge,
                        )
                    }
                }
            }
        }
    }
}
