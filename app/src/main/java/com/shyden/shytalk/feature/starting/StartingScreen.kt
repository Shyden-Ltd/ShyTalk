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
import androidx.compose.ui.graphics.asImageBitmap
import androidx.compose.ui.graphics.painter.BitmapPainter
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.tooling.preview.Preview
import androidx.compose.ui.unit.dp
import androidx.core.graphics.drawable.toBitmap
import coil3.compose.AsyncImage
import com.shyden.shytalk.R
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.ui.theme.ShyTalkTheme
import org.jetbrains.compose.resources.stringResource
import com.shyden.shytalk.data.remote.StartingScreen as StartingScreenData

/**
 * Full-screen starting screen composable.
 *
 * Shows ShyTalk branding, template/image icon, title, message,
 * and optionally a dismiss button. Can have a background image
 * with a dark overlay for text readability.
 */
@Composable
fun StartingScreenComposable(
    screen: StartingScreenData,
    onDismiss: () -> Unit,
    backgroundImagePath: String? = null,
) {
    val context = LocalContext.current
    val templateColor =
        remember(screen.template) {
            when (screen.template) {
                "warning" -> Color(0xFFE74C3C)
                "promotional" -> Color(0xFF9B59B6)
                "announcement" -> Color(0xFF3498DB)
                "info" -> Color(0xFF2ECC71)
                else -> Color(0xFF2ECC71) // fallback to info
            }
        }

    Surface(
        modifier = Modifier.fillMaxSize(),
        color = MaterialTheme.colorScheme.background,
    ) {
        Box(modifier = Modifier.fillMaxSize()) {
            // Background image with overlay if provided
            if (backgroundImagePath != null) {
                AsyncImage(
                    model = backgroundImagePath,
                    contentDescription = null,
                    modifier = Modifier.fillMaxSize(),
                    contentScale = ContentScale.Crop,
                )
                // Dark overlay for text readability
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
                // ShyTalk app icon + logo (always present)
                val appIcon =
                    remember(context) {
                        try {
                            val drawable = context.packageManager.getApplicationIcon(context.packageName)
                            BitmapPainter(drawable.toBitmap(128, 128).asImageBitmap())
                        } catch (_: Exception) {
                            null
                        }
                    }

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

                // Template/image icon
                when (screen.imageType) {
                    "police_duck" -> {
                        Image(
                            painter =
                                androidx.compose.ui.res
                                    .painterResource(R.drawable.police_duck),
                            contentDescription = stringResource(Res.string.starting_screen_police_duck_description),
                            modifier = Modifier.size(120.dp),
                        )
                    }
                    else -> {
                        // Use template default icon
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

                // Title
                val displayTitle =
                    if (screen.screenId == "preLaunchGate") {
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

                // Message
                val displayMessage =
                    if (screen.screenId == "preLaunchGate") {
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

                // Dismiss button (only if dismissable)
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

@Preview(showBackground = true)
@Composable
fun StartingScreenPreview_Warning() {
    ShyTalkTheme(darkTheme = true) {
        StartingScreenComposable(
            screen =
                StartingScreenData(
                    screenId = "preLaunchGate",
                    enabled = true,
                    dismissable = false,
                    frequency = "every_launch",
                    template = "warning",
                    title = "ShyTalk is not available yet",
                    message =
                        "ShyTalk has not been released yet. To apply to test the application, " +
                            "contact Shyden. Testing is available for iOS and Android users.",
                    imageType = "police_duck",
                ),
            onDismiss = {},
        )
    }
}

@Preview(showBackground = true)
@Composable
fun StartingScreenPreview_Dismissable() {
    ShyTalkTheme(darkTheme = true) {
        StartingScreenComposable(
            screen =
                StartingScreenData(
                    screenId = "announcement1",
                    enabled = true,
                    dismissable = true,
                    frequency = "once",
                    template = "announcement",
                    title = "Welcome to ShyTalk!",
                    message = "We are excited to have you here. Explore voice rooms, chat with friends, and more!",
                ),
            onDismiss = {},
        )
    }
}
