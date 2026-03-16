package com.shyden.shytalk.core.ui.effects

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.rotate
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

/**
 * Renders the gift animation for the given giftId over the specified duration.
 * Calls [onFinished] when the animation completes.
 */
@Composable
fun GiftAnimation(
    giftId: String,
    durationMs: Long,
    onFinished: () -> Unit,
    modifier: Modifier = Modifier,
    eventId: Long = 0L,
) {
    val progress = remember { Animatable(0f) }

    LaunchedEffect(eventId, giftId) {
        progress.snapTo(0f)
        progress.animateTo(
            targetValue = 1f,
            animationSpec = tween(durationMillis = durationMs.toInt(), easing = LinearEasing),
        )
        onFinished()
    }

    Box(modifier = modifier.fillMaxSize()) {
        val coinValue = GiftEffectRegistry.coinValueForGiftId(giftId)
        GiftCanvas(giftId = giftId, coinValue = coinValue, progress = progress.value)
    }
}

@Composable
private fun GiftCanvas(
    giftId: String,
    coinValue: Int,
    progress: Float,
) {
    // Generate stable particle seeds per composition
    val particles =
        remember(giftId) {
            List(60) {
                Particle(
                    x = Random.nextFloat(),
                    y = Random.nextFloat(),
                    size = Random.nextFloat() * 8f + 2f,
                    speed = Random.nextFloat() * 0.5f + 0.5f,
                    angle = Random.nextFloat() * 360f,
                    color = randomValueColor(coinValue),
                )
            }
        }

    Canvas(modifier = Modifier.fillMaxSize()) {
        when {
            coinValue < 50 -> drawCommonEffect(progress, particles)
            coinValue < 200 -> drawUncommonEffect(progress, particles)
            coinValue < 2000 -> drawRareEffect(giftId, progress, particles)
            coinValue < 10000 -> drawEpicEffect(giftId, progress, particles)
            else -> drawLegendaryEffect(giftId, progress, particles)
        }
    }
}

private data class Particle(
    val x: Float,
    val y: Float,
    val size: Float,
    val speed: Float,
    val angle: Float,
    val color: Color,
)

// --- COMMON: gentle falling particles ---
private fun DrawScope.drawCommonEffect(
    progress: Float,
    particles: List<Particle>,
) {
    val w = size.width
    val h = size.height
    particles.take(20).forEachIndexed { i, p ->
        val delay = i * 0.03f
        val localProgress = ((progress - delay) / (1f - delay)).coerceIn(0f, 1f)
        val x = p.x * w + sin(localProgress * PI.toFloat() * 2f * p.speed) * 30f
        val y = localProgress * h * 1.2f - h * 0.1f
        val alpha = if (localProgress > 0.8f) (1f - localProgress) / 0.2f else 1f
        val rotation = localProgress * 360f * p.speed
        rotate(degrees = rotation, pivot = Offset(x, y)) {
            drawOval(
                color = p.color.copy(alpha = alpha.coerceIn(0f, 1f)),
                topLeft = Offset(x - p.size, y - p.size * 0.6f),
                size = Size(p.size * 2f, p.size * 1.2f),
            )
        }
    }
}

// --- UNCOMMON: rising sparkles + shimmer ---
private fun DrawScope.drawUncommonEffect(
    progress: Float,
    particles: List<Particle>,
) {
    val w = size.width
    val h = size.height
    // Shimmer bar
    val shimmerX = progress * w * 1.5f - w * 0.25f
    drawRect(
        color = Color.White.copy(alpha = 0.1f),
        topLeft = Offset(shimmerX, 0f),
        size = Size(w * 0.15f, h),
    )
    // Rising sparkles
    particles.take(30).forEachIndexed { i, p ->
        val delay = i * 0.02f
        val localProgress = ((progress - delay) / (1f - delay)).coerceIn(0f, 1f)
        val x = p.x * w
        val y = h - localProgress * h * 1.3f
        val alpha = if (localProgress > 0.7f) (1f - localProgress) / 0.3f else localProgress.coerceAtMost(1f)
        val sparkSize = p.size * (0.5f + sin(localProgress * PI.toFloat() * 3f) * 0.5f)
        drawCircle(
            color = p.color.copy(alpha = alpha.coerceIn(0f, 1f)),
            radius = sparkSize,
            center = Offset(x, y),
        )
    }
}

// --- RARE: themed effects based on specific gift ---
private fun DrawScope.drawRareEffect(
    giftId: String,
    progress: Float,
    particles: List<Particle>,
) {
    val w = size.width
    val h = size.height
    val cx = w / 2f
    val cy = h / 2f

    // Central burst
    val burstProgress = (progress * 3f).coerceAtMost(1f)
    val burstAlpha = if (progress > 0.7f) (1f - progress) / 0.3f else burstProgress
    val burstRadius = burstProgress * w * 0.3f

    drawCircle(
        color = Color(0xFFFFD700).copy(alpha = burstAlpha.coerceIn(0f, 0.3f)),
        radius = burstRadius,
        center = Offset(cx, cy),
    )

    // Orbiting particles
    particles.take(40).forEachIndexed { i, p ->
        val delay = i * 0.015f
        val localProgress = ((progress - delay) / (1f - delay)).coerceIn(0f, 1f)
        val angle = p.angle + localProgress * 720f
        val radius = burstRadius * (0.5f + p.speed * 0.8f) * localProgress
        val px = cx + cos(angle * PI.toFloat() / 180f) * radius
        val py = cy + sin(angle * PI.toFloat() / 180f) * radius
        val alpha = if (localProgress > 0.8f) (1f - localProgress) / 0.2f else localProgress
        drawCircle(
            color = p.color.copy(alpha = alpha.coerceIn(0f, 1f)),
            radius = p.size * (1f + localProgress),
            center = Offset(px, py),
        )
    }

    // Gift-specific overlay effect
    when (giftId) {
        "dragon" -> {
            // Fire trail
            val trailX = progress * w * 1.5f - w * 0.25f
            val trailY = cy + sin(progress * PI.toFloat() * 4f) * h * 0.2f
            for (j in 0..10) {
                val offset = j * 15f
                drawCircle(
                    color = Color(0xFFFF4500).copy(alpha = (0.6f - j * 0.05f).coerceIn(0f, 1f) * burstAlpha),
                    radius = 12f - j,
                    center = Offset(trailX - offset, trailY + sin((progress * 10f + j).toDouble()).toFloat() * 10f),
                )
            }
        }
        "crown" -> {
            // Golden rays
            for (ray in 0..7) {
                val rayAngle = ray * 45f + progress * 90f
                val rayLen = burstRadius * 1.5f * burstProgress
                val endX = cx + cos(rayAngle * PI.toFloat() / 180f) * rayLen
                val endY = cy + sin(rayAngle * PI.toFloat() / 180f) * rayLen
                drawLine(
                    color = Color(0xFFFFD700).copy(alpha = burstAlpha.coerceIn(0f, 0.5f)),
                    start = Offset(cx, cy),
                    end = Offset(endX, endY),
                    strokeWidth = 3f,
                )
            }
        }
        else -> {} // Default rare effect (burst + orbiting particles) is enough
    }
}

// --- EPIC: full-screen effects ---
private fun DrawScope.drawEpicEffect(
    giftId: String,
    progress: Float,
    particles: List<Particle>,
) {
    val w = size.width
    val h = size.height
    val cx = w / 2f
    val cy = h / 2f

    // Background pulse
    val pulseAlpha = sin(progress * PI.toFloat() * 6f) * 0.08f + 0.05f
    drawRect(
        color = Color(0xFF9C27B0).copy(alpha = pulseAlpha.coerceIn(0f, 0.15f)),
        size = size,
    )

    // Central vortex
    particles.take(50).forEachIndexed { i, p ->
        val delay = i * 0.01f
        val localProgress = ((progress - delay) / (1f - delay)).coerceIn(0f, 1f)
        val spiralAngle = p.angle + localProgress * 1080f
        val spiralRadius = w * 0.4f * (1f - localProgress * 0.5f) * p.speed
        val px = cx + cos(spiralAngle * PI.toFloat() / 180f) * spiralRadius
        val py = cy + sin(spiralAngle * PI.toFloat() / 180f) * spiralRadius
        val alpha = if (localProgress > 0.85f) (1f - localProgress) / 0.15f else localProgress.coerceAtMost(1f)

        drawCircle(
            color = p.color.copy(alpha = alpha.coerceIn(0f, 1f)),
            radius = p.size * (1.5f + sin(localProgress * PI.toFloat() * 4f) * 0.5f),
            center = Offset(px, py),
        )
    }

    // Rising columns for castle/spaceship
    if (giftId == "castle" || giftId == "spaceship") {
        val buildProgress = (progress * 2f).coerceAtMost(1f)
        val columnAlpha = if (progress > 0.8f) (1f - progress) / 0.2f else buildProgress
        for (col in 0..4) {
            val colX = w * (0.15f + col * 0.175f)
            val colHeight = h * 0.4f * buildProgress
            drawRect(
                color = Color(0xFFFFD700).copy(alpha = columnAlpha.coerceIn(0f, 0.25f)),
                topLeft = Offset(colX - 10f, h - colHeight),
                size = Size(20f, colHeight),
            )
        }
    }

    // Aurora waves
    if (giftId == "aurora") {
        for (wave in 0..3) {
            val waveY = h * (0.2f + wave * 0.15f)
            val waveColor =
                when (wave % 4) {
                    0 -> Color(0xFF00FF88)
                    1 -> Color(0xFF00BBFF)
                    2 -> Color(0xFFFF00FF)
                    else -> Color(0xFFFFFF00)
                }
            for (x in 0..20) {
                val px = x * w / 20f
                val py = waveY + sin((progress * PI.toFloat() * 4f + x * 0.5f + wave).toDouble()).toFloat() * 40f
                drawCircle(
                    color = waveColor.copy(alpha = 0.2f),
                    radius = 15f,
                    center = Offset(px, py),
                )
            }
        }
    }
}

// --- LEGENDARY: maximum spectacle ---
private fun DrawScope.drawLegendaryEffect(
    giftId: String,
    progress: Float,
    particles: List<Particle>,
) {
    val w = size.width
    val h = size.height
    val cx = w / 2f
    val cy = h / 2f

    // Screen flash at start
    if (progress < 0.1f) {
        val flashAlpha = (1f - progress / 0.1f) * 0.4f
        drawRect(color = Color.White.copy(alpha = flashAlpha), size = size)
    }

    // Golden rays from center
    val rayCount = 16
    val rayProgress = (progress * 2f).coerceAtMost(1f)
    for (ray in 0 until rayCount) {
        val angle = ray * (360f / rayCount) + progress * 120f
        val rayLen = w * 0.6f * rayProgress
        val endX = cx + cos(angle * PI.toFloat() / 180f) * rayLen
        val endY = cy + sin(angle * PI.toFloat() / 180f) * rayLen
        val alpha = if (progress > 0.85f) (1f - progress) / 0.15f else rayProgress * 0.4f
        drawLine(
            color = Color(0xFFFFD700).copy(alpha = alpha.coerceIn(0f, 0.5f)),
            start = Offset(cx, cy),
            end = Offset(endX, endY),
            strokeWidth = 4f,
        )
    }

    // Particle storm — all particles active
    particles.forEachIndexed { i, p ->
        val delay = i * 0.008f
        val localProgress = ((progress - delay) / (1f - delay)).coerceIn(0f, 1f)

        // Spiraling outward then inward
        val spiralPhase = if (localProgress < 0.5f) localProgress * 2f else (1f - localProgress) * 2f
        val spiralAngle = p.angle + localProgress * 1440f
        val spiralRadius = w * 0.45f * spiralPhase * p.speed
        val px = cx + cos(spiralAngle * PI.toFloat() / 180f) * spiralRadius
        val py = cy + sin(spiralAngle * PI.toFloat() / 180f) * spiralRadius
        val alpha = if (localProgress > 0.9f) (1f - localProgress) / 0.1f else localProgress.coerceAtMost(1f)

        val particleSize = p.size * (2f + sin(localProgress * PI.toFloat() * 6f) * 0.8f)
        drawCircle(
            color = p.color.copy(alpha = alpha.coerceIn(0f, 1f)),
            radius = particleSize,
            center = Offset(px, py),
        )
    }

    // Camera shake effect — pulsing background
    val shakeIntensity =
        if (progress > 0.3f && progress < 0.8f) {
            sin(progress * PI.toFloat() * 20f) * 0.05f
        } else {
            0f
        }
    if (shakeIntensity > 0.01f) {
        drawRect(
            color = Color(0xFFFFD700).copy(alpha = shakeIntensity),
            size = size,
        )
    }

    // Celestial Throne specific: throne silhouette rising
    if (giftId == "celestial_throne") {
        val riseProgress = ((progress - 0.2f) / 0.5f).coerceIn(0f, 1f)
        val throneAlpha = if (progress > 0.85f) (1f - progress) / 0.15f else riseProgress * 0.3f
        // Throne base
        val throneWidth = w * 0.3f
        val throneHeight = h * 0.25f * riseProgress
        drawRect(
            color = Color(0xFFFFD700).copy(alpha = throneAlpha.coerceIn(0f, 0.4f)),
            topLeft = Offset(cx - throneWidth / 2f, cy - throneHeight / 2f),
            size = Size(throneWidth, throneHeight),
        )
        // Crown/backrest
        drawOval(
            color = Color(0xFFFFD700).copy(alpha = throneAlpha.coerceIn(0f, 0.3f)),
            topLeft = Offset(cx - throneWidth * 0.4f, cy - throneHeight - throneHeight * 0.3f),
            size = Size(throneWidth * 0.8f, throneHeight * 0.6f),
        )
    }
}

private fun randomValueColor(coinValue: Int): Color =
    when {
        coinValue < 50 ->
            listOf(
                Color(0xFFFFB6C1),
                Color(0xFFFF69B4),
                Color(0xFFFFC0CB),
                Color(0xFFFFDAB9),
                Color(0xFFFFE4E1),
            ).random()
        coinValue < 200 ->
            listOf(
                Color(0xFF4CAF50),
                Color(0xFF81C784),
                Color(0xFFA5D6A7),
                Color(0xFF66BB6A),
                Color(0xFF43A047),
            ).random()
        coinValue < 2000 ->
            listOf(
                Color(0xFF2196F3),
                Color(0xFF42A5F5),
                Color(0xFFFFD700),
                Color(0xFF64B5F6),
                Color(0xFF1E88E5),
            ).random()
        coinValue < 10000 ->
            listOf(
                Color(0xFF9C27B0),
                Color(0xFFAB47BC),
                Color(0xFFCE93D8),
                Color(0xFF7B1FA2),
                Color(0xFFE040FB),
            ).random()
        else ->
            listOf(
                Color(0xFFFFD700),
                Color(0xFFFF6B00),
                Color(0xFFFF1744),
                Color(0xFFFFAB00),
                Color(0xFFFFC107),
            ).random()
    }
