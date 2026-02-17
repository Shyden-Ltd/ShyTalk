package com.shyden.shytalk.feature.suspension

import androidx.compose.animation.AnimatedContent
import androidx.compose.animation.AnimatedVisibility
import androidx.compose.animation.fadeIn
import androidx.compose.animation.scaleIn
import androidx.compose.animation.slideInVertically
import androidx.compose.animation.slideOutVertically
import androidx.compose.animation.togetherWith
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.Image
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.ui.draw.clip
import androidx.compose.ui.res.painterResource
import com.shyden.shytalk.R
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.OutlinedTextField
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableLongStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import kotlinx.coroutines.delay
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontFamily
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.shyden.shytalk.core.util.formatSuspensionEndDateTime
import kotlin.math.cos
import kotlin.math.sin
import kotlin.random.Random

@Composable
fun SuspensionScreen(
    reason: String?,
    endDate: Long?,
    canAppeal: Boolean,
    appealStatus: String?,
    onSubmitAppeal: (String) -> Unit,
    onSignOut: () -> Unit,
    isLoading: Boolean
) {
    var appealText by remember { mutableStateOf("") }
    var appealSubmitted by remember { mutableStateOf(false) }
    var countdownExpired by remember { mutableStateOf(endDate != null && endDate <= System.currentTimeMillis()) }

    Surface(modifier = Modifier.fillMaxSize()) {
    Box(modifier = Modifier.fillMaxSize()) {
        if (countdownExpired) {
            Fireworks()
        }
    Column(
        modifier = Modifier
            .fillMaxSize()
            .padding(32.dp)
            .verticalScroll(rememberScrollState()),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        Image(
            painter = painterResource(R.drawable.police_duck),
            contentDescription = "Police duck",
            modifier = Modifier
                .size(160.dp)
                .clip(CircleShape)
        )

        Spacer(modifier = Modifier.height(24.dp))

        Text(
            text = suspensionTitle(countdownExpired),
            style = MaterialTheme.typography.headlineMedium,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(12.dp))

        if (shouldShowReason(countdownExpired, reason)) {
            Text(
                text = "Reason: $reason",
                style = MaterialTheme.typography.bodyLarge,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
            Spacer(modifier = Modifier.height(12.dp))
        }

        if (endDate != null) {
            var remainingMs by remember { mutableLongStateOf(endDate - System.currentTimeMillis()) }

            LaunchedEffect(endDate) {
                while (true) {
                    remainingMs = (endDate - System.currentTimeMillis()).coerceAtLeast(0)
                    if (remainingMs <= 0) break
                    delay(10L)
                }
            }

            val expired = remainingMs <= 0
            if (expired) countdownExpired = true

            if (!expired) {
                val days = (remainingMs / 86_400_000).toInt()
                val hours = ((remainingMs % 86_400_000) / 3_600_000).toInt()
                val minutes = ((remainingMs % 3_600_000) / 60_000).toInt()
                val seconds = ((remainingMs % 60_000) / 1_000).toInt()
                val millis = (remainingMs % 1_000).toInt()

                Text(
                    text = "Your suspension will end in:",
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
                Spacer(modifier = Modifier.height(8.dp))
                CountdownClock(days, hours, minutes, seconds, millis)

                Spacer(modifier = Modifier.height(8.dp))
                Text(
                    text = "Ends: ${formatSuspensionEndDateTime(endDate)}",
                    style = MaterialTheme.typography.bodySmall,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            } else {
                AnimatedVisibility(
                    visible = true,
                    enter = fadeIn() + scaleIn(initialScale = 0.5f)
                ) {
                    Text(
                        text = "You can log in again now.\nBe good this time!",
                        style = MaterialTheme.typography.titleMedium,
                        textAlign = TextAlign.Center,
                        color = MaterialTheme.colorScheme.primary
                    )
                }
            }
        } else {
            Text(
                text = "This suspension is permanent.",
                style = MaterialTheme.typography.bodyMedium,
                textAlign = TextAlign.Center,
                color = MaterialTheme.colorScheme.error
            )
        }

        Spacer(modifier = Modifier.height(32.dp))

        when {
            // Appeal form: eligible and hasn't appealed yet
            canAppeal && appealStatus == null && !appealSubmitted -> {
                OutlinedTextField(
                    value = appealText,
                    onValueChange = { if (it.length <= 500) appealText = it },
                    label = { Text("Appeal") },
                    placeholder = { Text("Explain why your suspension should be lifted...") },
                    modifier = Modifier.fillMaxWidth(),
                    minLines = 3,
                    maxLines = 6,
                    supportingText = { Text("${appealText.length}/500") }
                )

                Spacer(modifier = Modifier.height(12.dp))

                Button(
                    onClick = {
                        if (appealText.isNotBlank()) {
                            onSubmitAppeal(appealText.trim())
                            appealSubmitted = true
                        }
                    },
                    enabled = appealText.isNotBlank() && !isLoading,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    if (isLoading) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(20.dp),
                            color = MaterialTheme.colorScheme.onPrimary
                        )
                    } else {
                        Text("Submit Appeal")
                    }
                }
            }
            // Just submitted or pending review
            appealSubmitted || appealStatus == "pending" -> {
                Text(
                    text = "Your appeal has been submitted and will be reviewed. " +
                        "If successful, your suspension will be lifted. " +
                        "You will not receive any further feedback on your appeal " +
                        "and you cannot submit another appeal.",
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.primary
                )
            }
            // Rejected
            appealStatus == "rejected" -> {
                Text(
                    text = "Your appeal has been reviewed and was not successful. " +
                        "You cannot submit another appeal.",
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.error
                )
            }
            // Not eligible (no canAppeal, no appeal status) — hide after countdown expires
            !countdownExpired -> {
                Text(
                    text = "You are not eligible to appeal this suspension.",
                    style = MaterialTheme.typography.bodyMedium,
                    textAlign = TextAlign.Center,
                    color = MaterialTheme.colorScheme.onSurfaceVariant
                )
            }
        }

        Spacer(modifier = Modifier.height(24.dp))

        OutlinedButton(
            onClick = onSignOut,
            modifier = Modifier.fillMaxWidth(),
            colors = ButtonDefaults.outlinedButtonColors(
                contentColor = MaterialTheme.colorScheme.onSurfaceVariant
            )
        ) {
            Text(if (countdownExpired) "Sign In" else "Sign Out")
        }

        Spacer(modifier = Modifier.height(16.dp))

        Text(
            text = "For support, contact shytalk.help@gmail.com",
            style = MaterialTheme.typography.bodySmall,
            textAlign = TextAlign.Center,
            color = MaterialTheme.colorScheme.onSurfaceVariant
        )
    }
    }
    }
}

@Composable
private fun CountdownClock(
    days: Int,
    hours: Int,
    minutes: Int,
    seconds: Int,
    millis: Int
) {
    val segmentBg = MaterialTheme.colorScheme.surfaceVariant
    val digitColor = MaterialTheme.colorScheme.onSurfaceVariant
    val labelColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.6f)
    val separatorColor = MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)

    Row(
        horizontalArrangement = Arrangement.Center,
        verticalAlignment = Alignment.CenterVertically
    ) {
        if (days > 0) {
            ClockSegment(days.toString(), "DAY", segmentBg, digitColor, labelColor)
            ClockSeparator(separatorColor)
        }
        ClockSegment(hours.toString().padStart(2, '0'), "HR", segmentBg, digitColor, labelColor)
        ClockSeparator(separatorColor)
        ClockSegment(minutes.toString().padStart(2, '0'), "MIN", segmentBg, digitColor, labelColor)
        ClockSeparator(separatorColor)
        ClockSegment(seconds.toString().padStart(2, '0'), "SEC", segmentBg, digitColor, labelColor)
        ClockSeparator(separatorColor)
        ClockSegment(millis.toString().padStart(3, '0'), "MS", segmentBg, digitColor, labelColor, animate = false)
    }
}

@Composable
private fun ClockSegment(
    value: String,
    label: String,
    background: androidx.compose.ui.graphics.Color,
    digitColor: androidx.compose.ui.graphics.Color,
    labelColor: androidx.compose.ui.graphics.Color,
    animate: Boolean = true
) {
    val digitStyle = MaterialTheme.typography.headlineSmall.copy(
        fontFamily = FontFamily.Monospace,
        fontWeight = FontWeight.Bold,
        letterSpacing = 2.sp
    )
    Column(horizontalAlignment = Alignment.CenterHorizontally) {
        Box(
            modifier = Modifier
                .background(background, RoundedCornerShape(8.dp))
                .padding(horizontal = 8.dp, vertical = 6.dp),
            contentAlignment = Alignment.Center
        ) {
            // Invisible placeholder for stable width
            Text(
                text = if (value.length == 3) "000" else "00",
                style = digitStyle,
                color = digitColor.copy(alpha = 0f)
            )
            if (animate) {
                AnimatedContent(
                    targetState = value,
                    transitionSpec = {
                        slideInVertically { -it } togetherWith slideOutVertically { it }
                    },
                    label = "digit"
                ) { target ->
                    Text(text = target, style = digitStyle, color = digitColor)
                }
            } else {
                Text(text = value, style = digitStyle, color = digitColor)
            }
        }
        Spacer(modifier = Modifier.height(2.dp))
        Text(
            text = label,
            style = MaterialTheme.typography.labelSmall,
            color = labelColor
        )
    }
}

@Composable
private fun ClockSeparator(color: androidx.compose.ui.graphics.Color) {
    Text(
        text = ":",
        style = MaterialTheme.typography.headlineSmall.copy(
            fontFamily = FontFamily.Monospace,
            fontWeight = FontWeight.Bold
        ),
        color = color,
        modifier = Modifier.padding(horizontal = 2.dp, vertical = 0.dp)
    )
}

internal fun suspensionTitle(countdownExpired: Boolean): String =
    if (countdownExpired) "Account Unlocked" else "Account Suspended"

internal fun shouldShowReason(countdownExpired: Boolean, reason: String?): Boolean =
    !countdownExpired && !reason.isNullOrBlank()

private data class FireworkParticle(
    val originX: Float,
    val originY: Float,
    val angle: Float,
    val speed: Float,
    val color: Color,
    val birthTime: Long,
    val lifetime: Long
)

@Composable
private fun Fireworks() {
    val particles = remember { mutableStateOf(listOf<FireworkParticle>()) }
    val startTime = remember { System.currentTimeMillis() }
    var tick by remember { mutableLongStateOf(0L) }

    val colors = remember {
        listOf(
            Color(0xFFFF4444), Color(0xFFFF8800), Color(0xFFFFDD00),
            Color(0xFF44FF44), Color(0xFF4488FF), Color(0xFFDD44FF),
            Color(0xFFFF44AA), Color(0xFF44FFDD)
        )
    }

    LaunchedEffect(Unit) {
        val rng = Random(startTime)
        while (true) {
            val now = System.currentTimeMillis()

            // Launch new bursts periodically (~every 300ms)
            if (now / 300 > (now - 16) / 300) {
                val burstX = 0.05f + rng.nextFloat() * 0.9f
                val burstY = 0.05f + rng.nextFloat() * 0.7f
                val burstColor = colors[rng.nextInt(colors.size)]
                val newParticles = (0 until 36).map { i ->
                    val baseAngle = i * 10f
                    val jitter = rng.nextFloat() * 15f - 7.5f
                    FireworkParticle(
                        originX = burstX,
                        originY = burstY,
                        angle = baseAngle + jitter,
                        speed = 0.15f + rng.nextFloat() * 0.25f,
                        color = if (rng.nextFloat() < 0.3f) colors[rng.nextInt(colors.size)] else burstColor,
                        birthTime = now,
                        lifetime = 800L + rng.nextLong(600)
                    )
                }
                particles.value = particles.value + newParticles
            }

            // Remove dead particles
            particles.value = particles.value.filter { now - it.birthTime < it.lifetime }

            tick = now
            delay(16L)
        }
    }

    Canvas(modifier = Modifier.fillMaxSize()) {
        val now = tick
        for (p in particles.value) {
            val age = (now - p.birthTime).toFloat()
            val progress = (age / p.lifetime).coerceIn(0f, 1f)
            val dist = p.speed * progress * size.width
            val gravity = 0.3f * progress * progress * size.height
            val rad = Math.toRadians(p.angle.toDouble())
            val x = p.originX * size.width + cos(rad).toFloat() * dist
            val y = p.originY * size.height + sin(rad).toFloat() * dist + gravity
            val alpha = (1f - progress).coerceIn(0f, 1f)
            val radius = (4f * (1f - progress * 0.5f))
            drawCircle(
                color = p.color.copy(alpha = alpha),
                radius = radius,
                center = Offset(x, y)
            )
        }
    }
}
