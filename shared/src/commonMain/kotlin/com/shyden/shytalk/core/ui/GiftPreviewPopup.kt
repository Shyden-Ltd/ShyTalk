package com.shyden.shytalk.core.ui

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.GiftEvent
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.play_effect
import org.jetbrains.compose.resources.stringResource

/**
 * Full-screen popup showing a gift preview with large icon, name, value,
 * and a "Play Effect" button to preview the animation.
 * Dismiss by tapping outside the card.
 */
@Composable
fun GiftPreviewPopup(
    gift: Gift,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier,
) {
    var showEffect by remember { mutableStateOf(false) }

    Box(
        modifier =
            modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.6f))
                .clickable(
                    indication = null,
                    interactionSource = remember { MutableInteractionSource() },
                ) { onDismiss() },
        contentAlignment = Alignment.Center,
    ) {
        Surface(
            shape = RoundedCornerShape(24.dp),
            color = MaterialTheme.colorScheme.surface,
            shadowElevation = 8.dp,
            modifier =
                Modifier
                    .fillMaxWidth(0.75f)
                    .clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                    ) { /* consume tap on card */ },
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(24.dp),
            ) {
                // Large gift icon
                if (gift.iconUrl.isNotBlank()) {
                    AsyncImage(
                        model = gift.iconUrl,
                        contentDescription = gift.name,
                        modifier =
                            Modifier
                                .size(96.dp)
                                .clip(CircleShape),
                        contentScale = ContentScale.Crop,
                    )
                } else {
                    Surface(
                        modifier = Modifier.size(96.dp),
                        shape = CircleShape,
                        color = MaterialTheme.colorScheme.primaryContainer,
                    ) {
                        Box(contentAlignment = Alignment.Center) {
                            Text(
                                text = gift.name.take(2).uppercase(),
                                fontSize = 28.sp,
                                fontWeight = FontWeight.Bold,
                                color = MaterialTheme.colorScheme.onPrimaryContainer,
                            )
                        }
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // Gift name
                Text(
                    text = gift.name,
                    style = MaterialTheme.typography.titleLarge,
                    fontWeight = FontWeight.Bold,
                    textAlign = TextAlign.Center,
                )

                Spacer(modifier = Modifier.height(8.dp))

                // Coin value
                Text(
                    text = "\uD83E\uDE99 ${gift.coinValue}",
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp,
                    color = Color(0xFFFFD700),
                )

                Spacer(modifier = Modifier.height(20.dp))

                // Play Effect button
                Button(
                    onClick = { showEffect = true },
                    colors =
                        ButtonDefaults.buttonColors(
                            containerColor = MaterialTheme.colorScheme.primaryContainer,
                            contentColor = MaterialTheme.colorScheme.onPrimaryContainer,
                        ),
                    shape = RoundedCornerShape(50),
                ) {
                    Text(
                        text = stringResource(Res.string.play_effect),
                        fontWeight = FontWeight.Bold,
                    )
                }
            }
        }
    }

    // Full-screen animation preview
    if (showEffect) {
        val previewEvent =
            remember(gift.id) {
                GiftEvent(giftId = gift.id, giftName = gift.name)
            }
        GiftEffectOverlay(
            event = previewEvent,
            onFinished = { showEffect = false },
            modifier = Modifier.fillMaxSize(),
        )
    }
}
