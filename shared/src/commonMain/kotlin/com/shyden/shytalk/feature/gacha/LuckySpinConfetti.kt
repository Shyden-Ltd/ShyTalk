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
    val shape: Int // 0=rect, 1=circle, 2=strip
)

private val ConfettiColors = listOf(
    Color(0xFFFF1744), Color(0xFFFFD600), Color(0xFF00E676),
    Color(0xFF2979FF), Color(0xFFD500F9), Color(0xFFFF9100),
    Color(0xFF00BFA5), Color(0xFFFF6D00)
)

@Composable
fun LuckySpinConfetti(
    active: Boolean,
    particleCount: Int = 80,
    modifier: Modifier = Modifier
) {
    var particles by remember { mutableStateOf<List<ConfettiParticle>>(emptyList()) }

    LaunchedEffect(active) {
        if (!active) {
            particles = emptyList()
            return@LaunchedEffect
        }
        // Create burst of particles
        particles = List(particleCount) {
            ConfettiParticle(
                x = 0.5f + (Random.nextFloat() - 0.5f) * 0.15f,  // normalized coords
                y = 0.5f + 0.05f,
                vx = (Random.nextFloat() - 0.5f) * 0.04f,
                vy = -Random.nextFloat() * 0.04f - 0.012f,
                gravity = 0.0004f + Random.nextFloat() * 0.0002f,
                rotation = Random.nextFloat() * 6.28f,
                rotationSpeed = (Random.nextFloat() - 0.5f) * 0.06f,
                opacity = 1f,
                color = ConfettiColors.random(),
                particleSize = 3f + Random.nextFloat() * 9f,
                shape = Random.nextInt(3)
            )
        }

        // Physics loop
        var lastFrame = 0L
        while (true) {
            withFrameMillis { frameTime ->
                if (lastFrame == 0L) lastFrame = frameTime
                val dt = ((frameTime - lastFrame).coerceIn(0, 32)).toFloat()
                lastFrame = frameTime

                var anyAlive = false
                particles = particles.map { p ->
                    if (p.opacity <= 0f) return@map p
                    anyAlive = true
                    p.copy(
                        x = p.x + p.vx * dt * 0.06f,
                        y = p.y + p.vy * dt * 0.06f,
                        vx = p.vx * 0.995f,
                        vy = p.vy + p.gravity * dt * 0.06f,
                        rotation = p.rotation + p.rotationSpeed * dt * 0.06f,
                        opacity = if (p.y > 1f) (p.opacity - 0.02f).coerceAtLeast(0f) else p.opacity
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
        for (p in particles) {
            if (p.opacity <= 0f) continue
            val px = p.x * w
            val py = p.y * h
            val s = p.particleSize
            when (p.shape) {
                0 -> drawRect(
                    color = p.color.copy(alpha = p.opacity.coerceIn(0f, 1f)),
                    topLeft = Offset(px - s / 2, py - s * 0.3f),
                    size = Size(s, s * 0.6f)
                )
                1 -> drawCircle(
                    color = p.color.copy(alpha = p.opacity.coerceIn(0f, 1f)),
                    radius = s / 2,
                    center = Offset(px, py)
                )
                else -> drawRect(
                    color = p.color.copy(alpha = p.opacity.coerceIn(0f, 1f)),
                    topLeft = Offset(px - s / 2, py - 1f),
                    size = Size(s, 2.5f)
                )
            }
        }
    }
}
