package com.shyden.shytalk.ui.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Path
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.unit.sp
import kotlin.math.sin

private const val TWO_PI = 2 * kotlin.math.PI

private val DeepRedTop = Color(0xFF1A0505)
private val DeepRedBottom = Color(0xFF2A0808)
private val LanternRed = Color(0xFFD4263E)
private val Gold = Color(0xFFF0C246)
private val CloudWhite = Color(0xFFFFFFFF)

// Pre-computed alpha variants to avoid per-frame Color.copy() allocations
private val LanternBodyColor = LanternRed.copy(alpha = 0.7f)
private val GoldRimColor = Gold.copy(alpha = 0.8f)
private val GoldTasselColor = Gold.copy(alpha = 0.6f)
private val GoldHandleColor = Gold.copy(alpha = 0.7f)
private val RadialGlowColor = Color(0x30D4263E)
private val BackgroundGradient = Brush.verticalGradient(listOf(DeepRedTop, DeepRedBottom))
private val HorseWatermarkColor = Color.White.copy(alpha = 0.07f)

private data class LanternConfig(
    val xFraction: Float,
    val yFraction: Float,
    val size: Float,
    val phaseOffset: Float
)

private data class SparkleConfig(
    val xFraction: Float,
    val speedFactor: Float,
    val phaseOffset: Float,
    val radius: Float
)

@Composable
fun CnyRoomBackground(modifier: Modifier = Modifier) {
    val infiniteTransition = rememberInfiniteTransition(label = "cny_bg")

    // Master sway animation for lanterns (0..1 over 4s)
    val swayProgress by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(4000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "sway"
    )

    // Sparkle fall animation (0..1 over 8s)
    val sparkleProgress by infiniteTransition.animateFloat(
        initialValue = 0f,
        targetValue = 1f,
        animationSpec = infiniteRepeatable(
            animation = tween(8000, easing = LinearEasing),
            repeatMode = RepeatMode.Restart
        ),
        label = "sparkle"
    )

    val lanterns = remember {
        listOf(
            LanternConfig(0.12f, 0.08f, 40f, 0f),
            LanternConfig(0.85f, 0.05f, 35f, 0.3f),
            LanternConfig(0.30f, 0.12f, 30f, 0.6f),
            LanternConfig(0.70f, 0.10f, 32f, 0.15f),
            LanternConfig(0.50f, 0.06f, 38f, 0.45f),
            LanternConfig(0.20f, 0.18f, 28f, 0.75f)
        )
    }

    val sparkles = remember {
        listOf(
            SparkleConfig(0.08f, 0.7f, 0.0f, 2.5f),
            SparkleConfig(0.15f, 0.9f, 0.15f, 2f),
            SparkleConfig(0.25f, 0.6f, 0.3f, 3f),
            SparkleConfig(0.35f, 0.8f, 0.45f, 2.5f),
            SparkleConfig(0.45f, 1.0f, 0.6f, 2f),
            SparkleConfig(0.55f, 0.65f, 0.1f, 3f),
            SparkleConfig(0.62f, 0.85f, 0.5f, 2.5f),
            SparkleConfig(0.72f, 0.75f, 0.25f, 2f),
            SparkleConfig(0.80f, 0.95f, 0.7f, 3f),
            SparkleConfig(0.88f, 0.6f, 0.35f, 2.5f),
            SparkleConfig(0.93f, 0.8f, 0.55f, 2f),
            SparkleConfig(0.05f, 0.7f, 0.8f, 2.5f),
            SparkleConfig(0.40f, 0.9f, 0.9f, 2f),
            SparkleConfig(0.68f, 0.65f, 0.05f, 3f),
            SparkleConfig(0.50f, 0.75f, 0.65f, 2.5f)
        )
    }

    Box(modifier = modifier.fillMaxSize()) {
        Canvas(modifier = Modifier.fillMaxSize()) {
            // Base gradient
            drawRect(brush = BackgroundGradient)

            // Radial glow from center
            drawCircle(
                brush = Brush.radialGradient(
                    colors = listOf(RadialGlowColor, Color.Transparent),
                    center = Offset(size.width / 2, size.height / 2),
                    radius = size.minDimension * 0.6f
                )
            )

            // Floating lanterns
            lanterns.forEach { lantern ->
                val swayOffset = sin((swayProgress + lantern.phaseOffset) * TWO_PI).toFloat() * 8f
                val cx = size.width * lantern.xFraction + swayOffset
                val cy = size.height * lantern.yFraction
                drawLantern(cx, cy, lantern.size)
            }

            // Gold sparkles
            sparkles.forEach { sparkle ->
                val rawProgress = (sparkleProgress * sparkle.speedFactor + sparkle.phaseOffset) % 1f
                val y = rawProgress * (size.height + 40f) - 20f
                val x = size.width * sparkle.xFraction
                val alpha = when {
                    rawProgress < 0.1f -> rawProgress / 0.1f
                    rawProgress > 0.9f -> (1f - rawProgress) / 0.1f
                    else -> 1f
                } * 0.8f
                drawCircle(
                    color = Gold.copy(alpha = alpha),
                    radius = sparkle.radius,
                    center = Offset(x, y)
                )
            }

            // Cloud wisps near bottom
            drawCloudWisp(
                startX = 0f,
                y = size.height * 0.88f,
                width = size.width * 0.35f,
                alpha = 0.06f
            )
            drawCloudWisp(
                startX = size.width * 0.65f,
                y = size.height * 0.92f,
                width = size.width * 0.35f,
                alpha = 0.06f
            )
            drawCloudWisp(
                startX = size.width * 0.3f,
                y = size.height * 0.95f,
                width = size.width * 0.4f,
                alpha = 0.05f
            )
        }

        // Horse watermark
        Text(
            text = "\uD83D\uDC0E",
            fontSize = 200.sp,
            color = HorseWatermarkColor,
            modifier = Modifier.align(Alignment.Center)
        )
    }
}

private fun DrawScope.drawLantern(cx: Float, cy: Float, bodySize: Float) {
    val halfBody = bodySize / 2
    val bodyHeight = bodySize * 0.6f

    // Lantern body (oval)
    drawOval(
        color = LanternBodyColor,
        topLeft = Offset(cx - halfBody, cy - bodyHeight),
        size = Size(bodySize, bodySize * 1.2f)
    )

    // Gold rim top
    drawOval(
        color = GoldRimColor,
        topLeft = Offset(cx - halfBody - 2, cy - bodyHeight - 2),
        size = Size(bodySize + 4, 6f),
    )

    // Gold rim bottom
    drawOval(
        color = GoldRimColor,
        topLeft = Offset(cx - halfBody - 2, cy + bodyHeight - 4),
        size = Size(bodySize + 4, 6f),
    )

    // Tassel lines
    val tasselTop = cy + bodyHeight
    for (i in -1..1) {
        drawLine(
            color = GoldTasselColor,
            start = Offset(cx + i * 3f, tasselTop),
            end = Offset(cx + i * 4f, tasselTop + bodySize * 0.5f),
            strokeWidth = 1.5f
        )
    }

    // Handle on top
    drawLine(
        color = GoldHandleColor,
        start = Offset(cx, cy - bodyHeight),
        end = Offset(cx, cy - bodySize * 0.85f),
        strokeWidth = 2f
    )
}

private fun DrawScope.drawCloudWisp(startX: Float, y: Float, width: Float, alpha: Float) {
    val path = Path().apply {
        moveTo(startX, y)
        cubicTo(
            startX + width * 0.25f, y - 30f,
            startX + width * 0.5f, y - 25f,
            startX + width * 0.75f, y - 15f
        )
        cubicTo(
            startX + width * 0.85f, y - 10f,
            startX + width, y - 5f,
            startX + width, y
        )
    }
    drawPath(
        path = path,
        color = CloudWhite.copy(alpha = alpha),
        style = Stroke(width = 20f)
    )
}
