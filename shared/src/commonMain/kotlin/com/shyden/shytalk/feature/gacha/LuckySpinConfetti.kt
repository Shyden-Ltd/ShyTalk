package com.shyden.shytalk.feature.gacha

import androidx.compose.foundation.Canvas
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.runtime.withFrameMillis
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import kotlin.random.Random

private data class ConfettiParticle(
    var x: Float,
    var y: Float,
    var vx: Float,
    var vy: Float,
    val gravity: Float,
    var rotation: Float,
    val rotationSpeed: Float,
    var opacity: Float,
    val color: Color,
    val particleSize: Float,
    val shape: Int, // 0=rect, 1=circle, 2=strip
)

private val ConfettiColors =
    listOf(
        Color(0xFFFF1744),
        Color(0xFFFFD600),
        Color(0xFF00E676),
        Color(0xFF2979FF),
        Color(0xFFD500F9),
        Color(0xFFFF9100),
        Color(0xFF00BFA5),
        Color(0xFFFF6D00),
    )

@Composable
fun LuckySpinConfetti(
    active: Boolean,
    particleCount: Int = 80,
    modifier: Modifier = Modifier,
) {
    var particles by remember { mutableStateOf<List<ConfettiParticle>>(emptyList()) }

    LaunchedEffect(active) {
        if (!active) {
            particles = emptyList()
            return@LaunchedEffect
        }
        // Create burst of particles
        particles =
            List(particleCount) {
                ConfettiParticle(
                    x = 0.5f + (Random.nextFloat() - 0.5f) * 0.15f, // normalized coords
                    y = 0.5f + 0.05f,
                    vx = (Random.nextFloat() - 0.5f) * 0.04f,
                    vy = -Random.nextFloat() * 0.04f - 0.012f,
                    gravity = 0.0004f + Random.nextFloat() * 0.0002f,
                    rotation = Random.nextFloat() * 6.28f,
                    rotationSpeed = (Random.nextFloat() - 0.5f) * 0.06f,
                    opacity = 1f,
                    color = ConfettiColors.random(),
                    particleSize = 3f + Random.nextFloat() * 9f,
                    shape = Random.nextInt(3),
                )
            }

        // Physics loop
        var lastFrame = 0L
        while (true) {
            withFrameMillis { frameTime ->
                if (lastFrame == 0L) lastFrame = frameTime
                val deltaTime = ((frameTime - lastFrame).coerceIn(0, 32)).toFloat()
                lastFrame = frameTime

                var anyAlive = false
                particles =
                    particles.map { particle ->
                        if (particle.opacity <= 0f) return@map particle
                        anyAlive = true
                        particle.copy(
                            x = particle.x + particle.vx * deltaTime * 0.06f,
                            y = particle.y + particle.vy * deltaTime * 0.06f,
                            vx = particle.vx * 0.995f,
                            vy = particle.vy + particle.gravity * deltaTime * 0.06f,
                            rotation = particle.rotation + particle.rotationSpeed * deltaTime * 0.06f,
                            opacity = if (particle.y > 1f) (particle.opacity - 0.02f).coerceAtLeast(0f) else particle.opacity,
                        )
                    }
                if (!anyAlive) {
                    particles = emptyList()
                }
            }
            if (particles.isEmpty()) break
        }
    }

    Canvas(modifier = modifier) {
        val w = size.width
        val h = size.height
        for (particle in particles) {
            if (particle.opacity <= 0f) continue
            val px = particle.x * w
            val py = particle.y * h
            val pSize = particle.particleSize
            when (particle.shape) {
                0 ->
                    drawRect(
                        color = particle.color.copy(alpha = particle.opacity.coerceIn(0f, 1f)),
                        topLeft = Offset(px - pSize / 2, py - pSize * 0.3f),
                        size = Size(pSize, pSize * 0.6f),
                    )
                1 ->
                    drawCircle(
                        color = particle.color.copy(alpha = particle.opacity.coerceIn(0f, 1f)),
                        radius = pSize / 2,
                        center = Offset(px, py),
                    )
                else ->
                    drawRect(
                        color = particle.color.copy(alpha = particle.opacity.coerceIn(0f, 1f)),
                        topLeft = Offset(px - pSize / 2, py - 1f),
                        size = Size(pSize, 2.5f),
                    )
            }
        }
    }
}
