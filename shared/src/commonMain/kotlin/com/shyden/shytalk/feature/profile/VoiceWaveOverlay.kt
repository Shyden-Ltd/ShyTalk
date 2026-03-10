package com.shyden.shytalk.feature.profile

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.StrokeCap
import androidx.compose.ui.graphics.drawscope.clipPath
import androidx.compose.ui.graphics.Path
import kotlin.math.sin

/**
 * Composable overlay that draws animated voice wave bars (like the chat head)
 * clipped to a circle. Layer this on top of a profile photo.
 */
@Composable
fun VoiceWaveOverlay(modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "voiceWave")
    val progress by transition.animateFloat(
        initialValue = 0f,
        targetValue = (2 * kotlin.math.PI).toFloat(),
        animationSpec = infiniteRepeatable(
            animation = tween(durationMillis = 2000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "waveProgress"
    )

    val barCount = 5
    val frequencies = floatArrayOf(1.0f, 1.6f, 1.2f, 1.8f, 1.4f)
    val phases = floatArrayOf(0f, 0.8f, 1.6f, 2.4f, 3.2f)

    Canvas(modifier = modifier.fillMaxSize()) {
        val w = size.width
        val h = size.height
        if (w == 0f || h == 0f) return@Canvas

        val clipCircle = Path().apply {
            addOval(androidx.compose.ui.geometry.Rect(0f, 0f, w, h))
        }

        clipPath(clipCircle) {
            val barWidth = w * 0.08f
            val totalBarSpan = (barCount - 1) * barWidth * 1.8f
            val startX = (w - totalBarSpan) / 2
            val minBarHeight = h * 0.08f
            val maxBarHeight = h * 0.45f
            val barBottom = h * 0.85f

            for (i in 0 until barCount) {
                val waveValue = sin((progress * frequencies[i] + phases[i]).toDouble()).toFloat()
                val normalized = (waveValue + 1f) / 2f
                val barHeight = minBarHeight + normalized * (maxBarHeight - minBarHeight)
                val x = startX + i * barWidth * 1.8f

                drawLine(
                    color = Color.White.copy(alpha = 0.4f),
                    start = Offset(x, barBottom),
                    end = Offset(x, barBottom - barHeight),
                    strokeWidth = barWidth,
                    cap = StrokeCap.Round
                )
            }
        }
    }
}
