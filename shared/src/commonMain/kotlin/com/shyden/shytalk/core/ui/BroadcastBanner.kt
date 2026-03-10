package com.shyden.shytalk.core.ui

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.BoxWithConstraints
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.offset
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CardGiftcard
import androidx.compose.material.icons.filled.Stars
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.mutableStateListOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.IntOffset
import androidx.compose.ui.unit.dp
import androidx.lifecycle.Lifecycle
import androidx.lifecycle.compose.LocalLifecycleOwner
import androidx.lifecycle.repeatOnLifecycle
import com.shyden.shytalk.core.model.Broadcast
import com.shyden.shytalk.core.model.BroadcastType
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.broadcast_gacha_win
import com.shyden.shytalk.resources.broadcast_gift_sent
import org.jetbrains.compose.resources.stringResource
import kotlinx.coroutines.delay
import kotlin.math.roundToInt

private val giftSendGradient = listOf(
    Color(0xFFFF6B35),
    Color(0xFFFFD700),
    Color(0xFFFF6B35)
)

private val gachaWinGradient = listOf(
    Color(0xFF7B2FBE),
    Color(0xFF4A90D9),
    Color(0xFF7B2FBE)
)

@Composable
fun BroadcastBanner(
    broadcasts: List<Broadcast>,
    modifier: Modifier = Modifier
) {
    val queue = remember { mutableStateListOf<Broadcast>() }
    val seenIds = remember { mutableSetOf<String>() }
    var currentBroadcast by remember { mutableStateOf<Broadcast?>(null) }
    val startTime = remember { currentTimeMillis() }

    val lifecycleOwner = LocalLifecycleOwner.current

    // Enqueue only broadcasts created after this composable was first shown
    LaunchedEffect(broadcasts) {
        val state = lifecycleOwner.lifecycle.currentState
        if (!state.isAtLeast(Lifecycle.State.RESUMED)) return@LaunchedEffect
        for (b in broadcasts) {
            if (b.id.isNotEmpty() && b.id !in seenIds) {
                seenIds.add(b.id)
                // Only enqueue broadcasts that happened after the app opened
                if (b.timestamp > startTime) {
                    queue.add(b)
                }
            }
        }
    }

    // Display loop: runs once and continuously drains the queue
    LaunchedEffect(Unit) {
        lifecycleOwner.repeatOnLifecycle(Lifecycle.State.RESUMED) {
            while (true) {
                if (queue.isEmpty()) {
                    delay(200)
                    continue
                }
                val next = queue.removeFirstOrNull() ?: continue
                currentBroadcast = next
                delay(3500) // total on-screen time driven by animation
                currentBroadcast = null
                delay(200) // brief gap between banners
            }
        }
    }

    val broadcast = currentBroadcast ?: return

    val isGachaWin = broadcast.type == BroadcastType.GACHA_WIN
    val gradient = if (isGachaWin) gachaWinGradient else giftSendGradient
    val icon = if (isGachaWin) Icons.Filled.Stars else Icons.Filled.CardGiftcard
    val qtyPrefix = if (broadcast.quantity > 1) "${broadcast.quantity}x " else ""
    val coinText = if (broadcast.giftCoinValue > 0) {
        " (${broadcast.giftCoinValue.formatWithCommas()})"
    } else ""
    val text = if (isGachaWin) {
        stringResource(Res.string.broadcast_gacha_win, broadcast.senderName, qtyPrefix, broadcast.giftName, coinText)
    } else {
        stringResource(Res.string.broadcast_gift_sent, broadcast.senderName, qtyPrefix, broadcast.giftName, coinText, broadcast.recipientName)
    }

    BoxWithConstraints(modifier = modifier.fillMaxWidth()) {
        val containerWidthPx = with(LocalDensity.current) { maxWidth.toPx() }
        val offsetX = remember { Animatable(containerWidthPx) }

        // Animate: slide in from right → pause in center → slide out to left
        LaunchedEffect(broadcast.id) {
            offsetX.snapTo(containerWidthPx)
            // Slide in (right → center)
            offsetX.animateTo(0f, animationSpec = tween(durationMillis = 600))
            // Pause in center
            delay(1800)
            // Slide out (center → left)
            offsetX.animateTo(-containerWidthPx, animationSpec = tween(durationMillis = 600))
        }

        Box(
            modifier = Modifier
                .fillMaxWidth()
                .offset { IntOffset(offsetX.value.roundToInt(), 0) }
                .padding(horizontal = 16.dp, vertical = 8.dp)
                .background(
                    brush = Brush.horizontalGradient(gradient),
                    shape = RoundedCornerShape(12.dp)
                )
                .padding(horizontal = 16.dp, vertical = 10.dp)
        ) {
            Row(verticalAlignment = Alignment.CenterVertically) {
                Icon(
                    imageVector = icon,
                    contentDescription = null,
                    tint = Color.White,
                    modifier = Modifier.size(20.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = text,
                    style = MaterialTheme.typography.bodyMedium.copy(
                        color = Color.White,
                        fontWeight = FontWeight.Bold
                    ),
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )
            }
        }
    }
}

private fun Int.formatWithCommas(): String {
    val str = this.toString()
    val result = StringBuilder()
    for ((i, c) in str.reversed().withIndex()) {
        if (i > 0 && i % 3 == 0) result.append(',')
        result.append(c)
    }
    return result.reverse().toString()
}
