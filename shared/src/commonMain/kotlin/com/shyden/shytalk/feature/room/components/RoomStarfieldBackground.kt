package com.shyden.shytalk.feature.room.components

import androidx.compose.animation.core.RepeatMode
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import kotlin.math.sin
import kotlin.random.Random

private data class Star(
    val x: Float,
    val y: Float,
    val baseRadius: Float,
    val phaseOffset: Float,
    val twinkleSpeed: Float,
    val brightness: Float,
)

@Composable
fun RoomStarfieldBackground(modifier: Modifier = Modifier) {
    val stars =
        remember {
            val rng = Random(42)
            List(100) {
                Star(
                    x = rng.nextFloat(),
                    y = rng.nextFloat(),
                    baseRadius = rng.nextFloat() * 1.5f + 0.5f,
                    phaseOffset = rng.nextFloat() * 6.2832f,
                    twinkleSpeed = rng.nextFloat() * 1.5f + 0.5f,
                    brightness = rng.nextFloat() * 0.6f + 0.4f,
                )
            }
        }

    val transition = rememberInfiniteTransition(label = "starfieldTwinkle")
    val phase by transition.animateFloat(
        initialValue = 0f,
        targetValue = 6.2832f,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = 8000),
                repeatMode = RepeatMode.Restart,
            ),
        label = "twinklePhase",
    )

    val gradientColors =
        remember {
            listOf(Color(0xFF0A0E21), Color(0xFF1A1A2E))
        }

    Canvas(modifier = modifier) {
        val dp = density // pixels per dp — scale radii so stars are visible on high-DPI

        // Dark gradient background
        drawRect(brush = Brush.verticalGradient(gradientColors))

        // Faint nebula circles for depth
        drawCircle(
            color = Color(0xFF4A148C),
            radius = size.minDimension * 0.35f,
            center = Offset(size.width * 0.25f, size.height * 0.3f),
            alpha = 0.06f,
        )
        drawCircle(
            color = Color(0xFF0D47A1),
            radius = size.minDimension * 0.28f,
            center = Offset(size.width * 0.75f, size.height * 0.65f),
            alpha = 0.06f,
        )
        drawCircle(
            color = Color(0xFF1A237E),
            radius = size.minDimension * 0.22f,
            center = Offset(size.width * 0.55f, size.height * 0.15f),
            alpha = 0.05f,
        )

        // Stars
        for (star in stars) {
            val twinkleAlpha = ((sin(phase * star.twinkleSpeed + star.phaseOffset) + 1f) / 2f)
            val alpha = twinkleAlpha * star.brightness
            val center = Offset(star.x * size.width, star.y * size.height)
            val radius = star.baseRadius * dp

            drawCircle(
                color = Color.White,
                radius = radius,
                center = center,
                alpha = alpha,
            )

            // Bright stars get a glow halo
            if (star.brightness > 0.8f) {
                drawCircle(
                    color = Color.White,
                    radius = radius * 3f,
                    center = center,
                    alpha = alpha * 0.12f,
                )
            }
        }
    }
}
