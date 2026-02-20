package com.shyden.shytalk.feature.gacha

import androidx.compose.animation.core.Animatable
import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
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
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.shyden.shytalk.core.model.GachaGift
import com.shyden.shytalk.core.model.GiftBracket
import com.shyden.shytalk.core.ui.SuperShyGold
import kotlinx.coroutines.delay
import kotlin.math.pow

private enum class SpinPhase {
    IDLE, ANIMATING, CELEBRATING, SHOW_SUMMARY
}

@Composable
fun LuckySpinOverlay(
    gachaState: GachaUiState,
    onSpin: () -> Unit,
    onQuickSpin: (Int) -> Unit,
    onAdvanceMultiSpin: () -> Unit,
    onSkipMultiSpin: () -> Unit,
    onDismissResults: () -> Unit,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    val winnableGifts = gachaState.winnableGifts
    val (outerGifts, innerGifts) = remember(winnableGifts) { buildRingLayout(winnableGifts) }

    var phase by remember { mutableStateOf(SpinPhase.IDLE) }
    var outerLitIndex by remember { mutableIntStateOf(-1) }
    var innerLitIndex by remember { mutableIntStateOf(-1) }
    var wonSegments by remember { mutableStateOf(emptySet<String>()) }
    var lastWin by remember { mutableStateOf<GachaGift?>(null) }
    var showConfetti by remember { mutableStateOf(false) }
    var confettiCount by remember { mutableIntStateOf(60) }
    var showFlash by remember { mutableStateOf(false) }
    var flashColor by remember { mutableStateOf(Color.White) }
    var spinProgress by remember { mutableStateOf<Pair<Int, Int>?>(null) }
    var activeTier by remember { mutableStateOf(SpinTiers[0]) }
    var skipAnimation by remember { mutableStateOf(false) }
    var showSummary by remember { mutableStateOf(false) }
    var allWins by remember { mutableStateOf<List<GachaGift>>(emptyList()) }

    // Screen shake
    val shakeX = remember { Animatable(0f) }
    val shakeY = remember { Animatable(0f) }

    suspend fun triggerShake(intensity: Float) {
        if (intensity <= 0f) return
        shakeX.snapTo(intensity)
        shakeY.snapTo(-intensity)
        shakeX.animateTo(0f, spring(dampingRatio = Spring.DampingRatioHighBouncy, stiffness = Spring.StiffnessMediumLow))
    }

    suspend fun celebrate(results: List<GachaGift>, midSpin: Boolean = false) {
        val bestBracket = results.maxByOrNull { it.bracket.ordinal }?.bracket ?: GiftBracket.COMMON
        val config = RarityConfigs[bestBracket] ?: return
        confettiCount = if (midSpin) config.burstCount / 2 else config.burstCount
        showConfetti = true
        if (config.flash) {
            flashColor = config.glowColor.copy(alpha = 0.3f)
            showFlash = true
            delay(600)
            showFlash = false
        }
        triggerShake(config.shakeIntensity)
        delay(if (midSpin) 400 else 3000)
        showConfetti = false
    }

    fun resetBoard() {
        outerLitIndex = -1
        innerLitIndex = -1
        wonSegments = emptySet()
        lastWin = null
        showSummary = false
        spinProgress = null
        phase = SpinPhase.IDLE
    }

    // Handle single spin result (1x)
    LaunchedEffect(gachaState.currentWin) {
        val win = gachaState.currentWin ?: return@LaunchedEffect
        if (phase != SpinPhase.ANIMATING) return@LaunchedEffect
        if (gachaState.isMultiSpin) return@LaunchedEffect

        allWins = listOf(win)

        if (skipAnimation) {
            val pos = resolveWinPosition(win.giftId, outerGifts, innerGifts)
            if (pos != null) {
                val key = "${if (pos.first == Ring.OUTER) "outer" else "inner"}-${pos.second}"
                wonSegments = setOf(key)
                if (pos.first == Ring.OUTER) { outerLitIndex = pos.second; innerLitIndex = -1 }
                else { innerLitIndex = pos.second; outerLitIndex = -1 }
            }
            lastWin = win
            phase = SpinPhase.CELEBRATING
            celebrate(listOf(win))
            showSummary = true
            phase = SpinPhase.SHOW_SUMMARY
            return@LaunchedEffect
        }

        val pos = resolveWinPosition(win.giftId, outerGifts, innerGifts)
            ?: run { phase = SpinPhase.IDLE; return@LaunchedEffect }

        // Chase phase (~2.8s) — light chase around both rings
        val totalDuration = 2800L
        val minInterval = 30L
        val maxInterval = 280L
        val startTime = System.currentTimeMillis()
        var step = 0

        while (true) {
            val elapsed = System.currentTimeMillis() - startTime
            val progress = (elapsed.toFloat() / totalDuration).coerceIn(0f, 1f)
            val interval = minInterval + ((maxInterval - minInterval) * progress.pow(3)).toLong()

            if (progress < 0.92f) {
                outerLitIndex = if (outerGifts.isNotEmpty()) step % outerGifts.size else -1
                innerLitIndex = if (innerGifts.isNotEmpty()) (innerGifts.size - (step % innerGifts.size)) % innerGifts.size else -1
            } else {
                // Lock to winner
                if (pos.first == Ring.OUTER) { outerLitIndex = pos.second; innerLitIndex = -1 }
                else { innerLitIndex = pos.second; outerLitIndex = -1 }
            }

            step++
            if (progress >= 1f) break
            delay(interval)
        }

        // Final lock
        if (pos.first == Ring.OUTER) { outerLitIndex = pos.second; innerLitIndex = -1 }
        else { innerLitIndex = pos.second; outerLitIndex = -1 }

        // Blink phase (3 cycles)
        repeat(3) {
            if (pos.first == Ring.OUTER) outerLitIndex = -1 else innerLitIndex = -1
            delay(130)
            if (pos.first == Ring.OUTER) outerLitIndex = pos.second else innerLitIndex = pos.second
            delay(130)
        }

        val key = "${if (pos.first == Ring.OUTER) "outer" else "inner"}-${pos.second}"
        wonSegments = setOf(key)
        lastWin = win
        phase = SpinPhase.CELEBRATING
        celebrate(listOf(win))
        showSummary = true
        phase = SpinPhase.SHOW_SUMMARY
    }

    // Handle multi-spin results (10x / 100x)
    LaunchedEffect(gachaState.isMultiSpin, gachaState.multiSpinResults) {
        if (!gachaState.isMultiSpin) return@LaunchedEffect
        if (gachaState.multiSpinResults.isEmpty()) return@LaunchedEffect
        if (phase != SpinPhase.ANIMATING) return@LaunchedEffect

        val results = gachaState.multiSpinResults
        allWins = results

        if (skipAnimation) {
            // Instant: populate all won segments
            val newWon = mutableSetOf<String>()
            for (r in results) {
                val pos = resolveWinPosition(r.giftId, outerGifts, innerGifts) ?: continue
                val key = "${if (pos.first == Ring.OUTER) "outer" else "inner"}-${pos.second}"
                newWon.add(key)
            }
            wonSegments = newWon
            outerLitIndex = -1
            innerLitIndex = -1
            onSkipMultiSpin()
            phase = SpinPhase.CELEBRATING
            celebrate(results)
            showSummary = true
            phase = SpinPhase.SHOW_SUMMARY
            return@LaunchedEffect
        }

        val is100x = results.size >= 100

        if (is100x) {
            // Bulk sweep animation (~2s)
            spinProgress = results.size to results.size
            val totalSteps = 60
            val intervalMs = 2000L / totalSteps
            val sweepPhase = (totalSteps * 0.65f).toInt()

            // Compute unique wins for reveal phase
            val uniqueWins = mutableListOf<Pair<Ring, Int>>()
            val seen = mutableSetOf<String>()
            val allWonSet = mutableSetOf<String>()
            for (r in results) {
                val pos = resolveWinPosition(r.giftId, outerGifts, innerGifts) ?: continue
                val key = "${if (pos.first == Ring.OUTER) "outer" else "inner"}-${pos.second}"
                allWonSet.add(key)
                if (key !in seen) { seen.add(key); uniqueWins.add(pos) }
            }

            for (step in 0..totalSteps) {
                if (step < sweepPhase) {
                    outerLitIndex = if (outerGifts.isNotEmpty()) step % outerGifts.size else -1
                    innerLitIndex = if (innerGifts.isNotEmpty()) (innerGifts.size - (step % innerGifts.size)) % innerGifts.size else -1
                } else {
                    val revealStep = step - sweepPhase
                    val revealIndex = ((revealStep.toFloat() / (totalSteps - sweepPhase)) * uniqueWins.size).toInt()
                        .coerceAtMost(uniqueWins.size - 1)
                    val revealed = mutableSetOf<String>()
                    for (i in 0..revealIndex) {
                        val p = uniqueWins[i]
                        revealed.add("${if (p.first == Ring.OUTER) "outer" else "inner"}-${p.second}")
                    }
                    wonSegments = revealed
                    val current = uniqueWins[revealIndex]
                    if (current.first == Ring.OUTER) { outerLitIndex = current.second; innerLitIndex = -1 }
                    else { innerLitIndex = current.second; outerLitIndex = -1 }
                }
                delay(intervalMs)
            }

            wonSegments = allWonSet
            outerLitIndex = -1
            innerLitIndex = -1
            onSkipMultiSpin()
        } else {
            // 10x: per-result quick chase
            val newWon = mutableSetOf<String>()
            for (i in results.indices) {
                spinProgress = (i + 1) to results.size
                val result = results[i]
                val pos = resolveWinPosition(result.giftId, outerGifts, innerGifts) ?: continue

                // Quick chase (260ms per result)
                val chaseDuration = 260L
                val startTime2 = System.currentTimeMillis()
                var chaseStep = 0
                while (true) {
                    val p = ((System.currentTimeMillis() - startTime2).toFloat() / chaseDuration).coerceIn(0f, 1f)
                    if (p < 0.75f) {
                        outerLitIndex = if (outerGifts.isNotEmpty()) chaseStep % outerGifts.size else -1
                        innerLitIndex = if (innerGifts.isNotEmpty()) (innerGifts.size - (chaseStep % innerGifts.size)) % innerGifts.size else -1
                    } else {
                        if (pos.first == Ring.OUTER) { outerLitIndex = pos.second; innerLitIndex = -1 }
                        else { innerLitIndex = pos.second; outerLitIndex = -1 }
                    }
                    chaseStep++
                    if (p >= 1f) break
                    delay(25)
                }

                // Lock on winner
                if (pos.first == Ring.OUTER) outerLitIndex = pos.second else innerLitIndex = pos.second
                val key = "${if (pos.first == Ring.OUTER) "outer" else "inner"}-${pos.second}"
                newWon.add(key)
                wonSegments = newWon.toSet()

                // Brief celebration for RARE+
                if (result.bracket.ordinal >= GiftBracket.RARE.ordinal) {
                    lastWin = result
                    celebrate(listOf(result), midSpin = true)
                }

                if (i < results.size - 1) delay(30)
                onAdvanceMultiSpin()
            }
            onSkipMultiSpin()
        }

        phase = SpinPhase.CELEBRATING
        celebrate(results)
        spinProgress = null
        showSummary = true
        phase = SpinPhase.SHOW_SUMMARY
    }

    // Main overlay layout
    Box(
        modifier = modifier
            .fillMaxSize()
            .background(Color.Black)
            .clickable(
                indication = null,
                interactionSource = remember { MutableInteractionSource() }
            ) { /* consume taps on scrim */ }
            .graphicsLayer {
                translationX = shakeX.value
                translationY = shakeY.value
            },
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 24.dp, vertical = 16.dp)
        ) {
            // Close + coin balance header
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically
            ) {
                IconButton(onClick = {
                    if (phase == SpinPhase.IDLE || phase == SpinPhase.SHOW_SUMMARY) {
                        resetBoard()
                        onDismissResults()
                        onDismiss()
                    }
                }) {
                    Icon(Icons.Default.Close, contentDescription = "Close", tint = Color.White)
                }

                Surface(
                    shape = RoundedCornerShape(30.dp),
                    color = Color(0xFFFFD700).copy(alpha = 0.06f)
                ) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        modifier = Modifier.padding(horizontal = 18.dp, vertical = 5.dp)
                    ) {
                        Text("\uD83E\uDE99", fontSize = 16.sp)
                        Spacer(modifier = Modifier.width(8.dp))
                        Text(
                            text = "${gachaState.coinBalance}",
                            color = SuperShyGold,
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 18.sp,
                            letterSpacing = 1.sp
                        )
                    }
                }
            }

            // Title
            Text(
                text = "LUCKY SPIN",
                fontSize = 26.sp,
                fontWeight = FontWeight.Black,
                letterSpacing = 2.sp,
                style = androidx.compose.ui.text.TextStyle(
                    brush = Brush.linearGradient(
                        listOf(
                            Color(0xFFFFD700), Color(0xFFFF6B00), Color(0xFFFF1744),
                            Color(0xFFD500F9), Color(0xFF2979FF), Color(0xFF00E676)
                        )
                    )
                )
            )

            Spacer(modifier = Modifier.height(4.dp))

            // Skip animation toggle
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center
            ) {
                Switch(
                    checked = skipAnimation,
                    onCheckedChange = { skipAnimation = it },
                    colors = SwitchDefaults.colors(
                        checkedThumbColor = Color(0xFF1A1A2E),
                        checkedTrackColor = Color(0xFFFFD700),
                        uncheckedThumbColor = Color(0xFF777777),
                        uncheckedTrackColor = Color(0xFF333333)
                    ),
                    modifier = Modifier.height(24.dp)
                )
                Spacer(modifier = Modifier.width(8.dp))
                Text(
                    text = "SKIP ANIMATION",
                    color = Color.White.copy(alpha = 0.3f),
                    fontSize = 11.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 1.sp
                )
            }

            Spacer(modifier = Modifier.height(4.dp))

            // Progress bar for multi-spin
            spinProgress?.let { (current, total) ->
                if (total > 1) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center,
                        modifier = Modifier.padding(horizontal = 32.dp)
                    ) {
                        LinearProgressIndicator(
                            progress = { current.toFloat() / total },
                            modifier = Modifier.weight(1f).height(6.dp),
                            color = activeTier.color,
                            trackColor = Color.White.copy(alpha = 0.07f)
                        )
                        Spacer(modifier = Modifier.width(10.dp))
                        Text(
                            text = "$current/$total",
                            color = Color.White.copy(alpha = 0.35f),
                            fontSize = 12.sp,
                            fontWeight = FontWeight.Bold
                        )
                    }
                    Spacer(modifier = Modifier.height(4.dp))
                }
            }

            // The dual-ring wheel
            LuckySpinWheel(
                outerGifts = outerGifts,
                innerGifts = innerGifts,
                outerLitIndex = outerLitIndex,
                innerLitIndex = innerLitIndex,
                wonSegments = wonSegments,
                modifier = Modifier.size(300.dp)
            )

            Spacer(modifier = Modifier.height(8.dp))

            // Last win display
            lastWin?.let { win ->
                if (phase != SpinPhase.IDLE && !showSummary) {
                    Row(
                        verticalAlignment = Alignment.CenterVertically,
                        horizontalArrangement = Arrangement.Center
                    ) {
                        Text(giftEmoji(win.giftName), fontSize = 22.sp)
                        Spacer(modifier = Modifier.width(6.dp))
                        Text(
                            text = "${win.giftName} — \uD83E\uDE99${win.coinValue}",
                            color = Color(0xFFFFD700),
                            fontWeight = FontWeight.ExtraBold,
                            fontSize = 14.sp
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                }
            }

            // Spin tier buttons
            if (phase == SpinPhase.IDLE) {
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier = Modifier.fillMaxWidth()
                ) {
                    SpinTiers.forEach { tier ->
                        val canAfford = gachaState.coinBalance >= tier.cost
                        val enabled = canAfford && !gachaState.isPulling

                        Button(
                            onClick = {
                                activeTier = tier
                                phase = SpinPhase.ANIMATING
                                wonSegments = emptySet()
                                outerLitIndex = -1
                                innerLitIndex = -1
                                lastWin = null
                                showConfetti = false
                                allWins = emptyList()
                                when (tier.count) {
                                    1 -> onSpin()
                                    else -> onQuickSpin(tier.count)
                                }
                            },
                            enabled = enabled,
                            colors = ButtonDefaults.buttonColors(
                                containerColor = tier.color.copy(alpha = 0.15f),
                                disabledContainerColor = Color(0xFF222222)
                            ),
                            shape = RoundedCornerShape(20.dp),
                            modifier = Modifier
                                .weight(1f)
                                .height(80.dp)
                        ) {
                            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                                Text(
                                    text = tier.label,
                                    fontSize = 22.sp,
                                    fontWeight = FontWeight.Black,
                                    color = if (enabled) tier.color else Color.Gray,
                                    letterSpacing = 1.sp,
                                    lineHeight = 24.sp
                                )
                                Text(
                                    text = "SPIN",
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = if (enabled) Color.White.copy(alpha = 0.55f) else Color.Gray.copy(alpha = 0.4f),
                                    letterSpacing = 1.sp
                                )
                                Surface(
                                    shape = RoundedCornerShape(12.dp),
                                    color = if (enabled) tier.color.copy(alpha = 0.12f) else Color.White.copy(alpha = 0.03f)
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier.padding(horizontal = 12.dp, vertical = 3.dp)
                                    ) {
                                        Text("\uD83E\uDE99", fontSize = 11.sp)
                                        Text(
                                            text = "${tier.cost}",
                                            fontSize = 13.sp,
                                            fontWeight = FontWeight.ExtraBold,
                                            color = if (enabled) tier.color else Color.Gray
                                        )
                                    }
                                }
                                if (tier.boostedDrop) {
                                    Text(
                                        text = "BOOSTED",
                                        fontSize = 8.sp,
                                        fontWeight = FontWeight.ExtraBold,
                                        letterSpacing = 1.5.sp,
                                        color = if (enabled) tier.color else Color.Gray
                                    )
                                }
                            }
                        }
                    }
                }
            } else if (phase == SpinPhase.ANIMATING) {
                Text(
                    text = "Spinning...",
                    color = Color.White,
                    fontWeight = FontWeight.Bold,
                    fontSize = 16.sp
                )
            }

            // Collect All button when celebrating (pre-summary)
            if (phase == SpinPhase.CELEBRATING && wonSegments.isNotEmpty() && !showSummary) {
                Spacer(modifier = Modifier.height(8.dp))
                Button(
                    onClick = { showSummary = true; phase = SpinPhase.SHOW_SUMMARY },
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color(0xFFFFD700).copy(alpha = 0.08f)
                    ),
                    shape = RoundedCornerShape(50)
                ) {
                    Text(
                        text = "COLLECT ALL (${allWins.size})",
                        color = Color(0xFFFFD700),
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 14.sp,
                        letterSpacing = 2.sp
                    )
                }
            }
        }

        // Confetti overlay
        LuckySpinConfetti(
            active = showConfetti,
            particleCount = confettiCount,
            modifier = Modifier.fillMaxSize()
        )

        // Screen flash overlay
        if (showFlash) {
            Box(
                modifier = Modifier
                    .fillMaxSize()
                    .background(flashColor)
            )
        }

        // Summary popup
        if (showSummary && allWins.isNotEmpty()) {
            LuckySpinSummaryPopup(
                wins = allWins,
                spinTier = activeTier,
                canAffordSpinAgain = gachaState.coinBalance >= activeTier.cost,
                onClose = {
                    resetBoard()
                    onDismissResults()
                },
                onSpinAgain = {
                    val tier = activeTier
                    resetBoard()
                    onDismissResults()
                    // Trigger new spin
                    phase = SpinPhase.ANIMATING
                    activeTier = tier
                    when (tier.count) {
                        1 -> onSpin()
                        else -> onQuickSpin(tier.count)
                    }
                }
            )
        }
    }
}
