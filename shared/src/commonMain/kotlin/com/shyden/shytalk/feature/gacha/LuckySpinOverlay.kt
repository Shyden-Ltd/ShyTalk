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
import androidx.compose.foundation.layout.IntrinsicSize
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.heightIn
import androidx.compose.foundation.layout.navigationBarsPadding
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material.icons.filled.Close
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.Surface
import androidx.compose.material3.Switch
import androidx.compose.material3.SwitchDefaults
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableIntStateOf
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.audio.GachaSoundPlayer
import com.shyden.shytalk.core.model.CoinPackage
import com.shyden.shytalk.core.model.GachaGift
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.Transaction
import com.shyden.shytalk.core.ui.SuperShyGold
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.feature.shop.CoinPackageCard
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import kotlinx.coroutines.delay
import org.jetbrains.compose.resources.stringResource
import kotlin.math.pow

private enum class SpinPhase {
    IDLE,
    ANIMATING,
    CELEBRATING,
    SHOW_SUMMARY,
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
    onTestPurchase: (Int) -> Unit = {},
    modifier: Modifier = Modifier,
) {
    val winnableGifts = gachaState.winnableGifts
    val innerThreshold = gachaState.wheelInnerThreshold
    val (outerGifts, innerGifts) =
        remember(winnableGifts, innerThreshold) {
            buildRingLayout(winnableGifts, innerThreshold)
        }

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
    val spinTiers = remember(gachaState.pullCosts) { buildSpinTiers(gachaState.pullCosts) }
    var activeTier by remember { mutableStateOf(spinTiers[0]) }
    var skipAnimation by remember { mutableStateOf(false) }
    var showSummary by remember { mutableStateOf(false) }
    var allWins by remember { mutableStateOf<List<GachaGift>>(emptyList()) }

    // Sound lifecycle
    DisposableEffect(Unit) {
        GachaSoundPlayer.init()
        onDispose { GachaSoundPlayer.release() }
    }

    // Dismiss keyboard when overlay opens
    val keyboardController = androidx.compose.ui.platform.LocalSoftwareKeyboardController.current
    LaunchedEffect(Unit) {
        keyboardController?.hide()
    }

    // Inline panel states
    var showCoinShop by remember { mutableStateOf(false) }
    var showHistory by remember { mutableStateOf(false) }
    var showPrizeList by remember { mutableStateOf(false) }

    // Screen shake
    val shakeX = remember { Animatable(0f) }
    val shakeY = remember { Animatable(0f) }

    suspend fun triggerShake(intensity: Float) {
        if (intensity <= 0f) return
        shakeX.snapTo(intensity)
        shakeY.snapTo(-intensity)
        shakeX.animateTo(0f, spring(dampingRatio = Spring.DampingRatioHighBouncy, stiffness = Spring.StiffnessMediumLow))
    }

    suspend fun celebrate(
        results: List<GachaGift>,
        midSpin: Boolean = false,
    ) {
        val bestCoinValue = results.maxByOrNull { it.coinValue }?.coinValue ?: 0
        val config = rarityConfigForCoinValue(bestCoinValue)
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

    // Recover from pull errors — if pulling finished with no results, reset to IDLE
    LaunchedEffect(gachaState.isPulling) {
        if (!gachaState.isPulling &&
            phase == SpinPhase.ANIMATING &&
            gachaState.currentWin == null &&
            gachaState.multiSpinResults.isEmpty()
        ) {
            resetBoard()
        }
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
                if (pos.first == Ring.OUTER) {
                    outerLitIndex = pos.second
                    innerLitIndex = -1
                } else {
                    innerLitIndex = pos.second
                    outerLitIndex = -1
                }
            }
            lastWin = win
            showSummary = true
            phase = SpinPhase.SHOW_SUMMARY
            return@LaunchedEffect
        }

        val pos =
            resolveWinPosition(win.giftId, outerGifts, innerGifts)
                ?: run {
                    phase = SpinPhase.IDLE
                    return@LaunchedEffect
                }

        // Chase phase (~2.8s) — light chase around both rings
        val totalDuration = 2800L
        val minInterval = 30L
        val maxInterval = 280L
        val startTime = currentTimeMillis()
        var step = 0

        while (true) {
            val elapsed = currentTimeMillis() - startTime
            val progress = (elapsed.toFloat() / totalDuration).coerceIn(0f, 1f)
            val interval = minInterval + ((maxInterval - minInterval) * progress.pow(3)).toLong()

            if (progress < 0.92f) {
                outerLitIndex = if (outerGifts.isNotEmpty()) step % outerGifts.size else -1
                innerLitIndex = if (innerGifts.isNotEmpty()) (innerGifts.size - (step % innerGifts.size)) % innerGifts.size else -1
            } else {
                // Lock to winner
                if (pos.first == Ring.OUTER) {
                    outerLitIndex = pos.second
                    innerLitIndex = -1
                } else {
                    innerLitIndex = pos.second
                    outerLitIndex = -1
                }
            }

            GachaSoundPlayer.playTick(progress)
            step++
            if (progress >= 1f) break
            delay(interval)
        }

        // Final lock
        if (pos.first == Ring.OUTER) {
            outerLitIndex = pos.second
            innerLitIndex = -1
        } else {
            innerLitIndex = pos.second
            outerLitIndex = -1
        }

        // Blink phase (3 cycles)
        repeat(3) {
            if (pos.first == Ring.OUTER) outerLitIndex = -1 else innerLitIndex = -1
            GachaSoundPlayer.playBlinkClick()
            delay(130)
            if (pos.first == Ring.OUTER) outerLitIndex = pos.second else innerLitIndex = pos.second
            GachaSoundPlayer.playBlinkClick()
            delay(130)
        }

        val key = "${if (pos.first == Ring.OUTER) "outer" else "inner"}-${pos.second}"
        wonSegments = setOf(key)
        lastWin = win
        GachaSoundPlayer.playWinReveal(win.coinValue)
        if (win.coinValue >= 500) {
            GachaSoundPlayer.playHighTierFanfare()
        }
        // Show summary immediately — don't wait for celebration animation
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
                if (key !in seen) {
                    seen.add(key)
                    uniqueWins.add(pos)
                }
            }

            for (step in 0..totalSteps) {
                if (step < sweepPhase || uniqueWins.isEmpty()) {
                    outerLitIndex = if (outerGifts.isNotEmpty()) step % outerGifts.size else -1
                    innerLitIndex = if (innerGifts.isNotEmpty()) (innerGifts.size - (step % innerGifts.size)) % innerGifts.size else -1
                    GachaSoundPlayer.playTick(step.toFloat() / totalSteps)
                } else {
                    val revealStep = step - sweepPhase
                    val revealIndex =
                        ((revealStep.toFloat() / (totalSteps - sweepPhase)) * uniqueWins.size)
                            .toInt()
                            .coerceAtMost(uniqueWins.size - 1)
                    val revealed = mutableSetOf<String>()
                    for (i in 0..revealIndex) {
                        val prize = uniqueWins[i]
                        revealed.add("${if (prize.first == Ring.OUTER) "outer" else "inner"}-${prize.second}")
                    }
                    wonSegments = revealed
                    val current = uniqueWins[revealIndex]
                    if (current.first == Ring.OUTER) {
                        outerLitIndex = current.second
                        innerLitIndex = -1
                    } else {
                        innerLitIndex = current.second
                        outerLitIndex = -1
                    }
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
                val chaseStartTime = currentTimeMillis()
                var chaseStep = 0
                while (true) {
                    val progress = ((currentTimeMillis() - chaseStartTime).toFloat() / chaseDuration).coerceIn(0f, 1f)
                    if (progress < 0.75f) {
                        outerLitIndex = if (outerGifts.isNotEmpty()) chaseStep % outerGifts.size else -1
                        innerLitIndex =
                            if (innerGifts.isNotEmpty()) (innerGifts.size - (chaseStep % innerGifts.size)) % innerGifts.size else -1
                    } else {
                        if (pos.first == Ring.OUTER) {
                            outerLitIndex = pos.second
                            innerLitIndex = -1
                        } else {
                            innerLitIndex = pos.second
                            outerLitIndex = -1
                        }
                    }
                    GachaSoundPlayer.playTick(progress)
                    chaseStep++
                    if (progress >= 1f) break
                    delay(25)
                }

                // Lock on winner
                if (pos.first == Ring.OUTER) outerLitIndex = pos.second else innerLitIndex = pos.second
                val key = "${if (pos.first == Ring.OUTER) "outer" else "inner"}-${pos.second}"
                newWon.add(key)
                wonSegments = newWon.toSet()

                // Brief celebration for high-value gifts
                if (result.coinValue >= 500) {
                    lastWin = result
                    celebrate(listOf(result), midSpin = true)
                }

                if (i < results.size - 1) delay(30)
                onAdvanceMultiSpin()
            }
            onSkipMultiSpin()
        }

        spinProgress = null
        val bestCoinValue = allWins.maxByOrNull { it.coinValue }?.coinValue ?: 0
        GachaSoundPlayer.playWinReveal(bestCoinValue)
        if (bestCoinValue >= 500) {
            GachaSoundPlayer.playHighTierFanfare()
        }
        // Show summary immediately — don't wait for celebration animation
        showSummary = true
        phase = SpinPhase.SHOW_SUMMARY
    }

    // Main overlay layout — bottom-aligned opaque panel, room visible above
    Box(
        modifier =
            modifier
                .fillMaxSize()
                .graphicsLayer {
                    translationX = shakeX.value
                    translationY = shakeY.value
                }.clickable(
                    indication = null,
                    interactionSource = remember { MutableInteractionSource() },
                ) {
                    // Tap outside the panel to close (only when idle)
                    if (phase == SpinPhase.IDLE && !showCoinShop && !showHistory && !showPrizeList && !showSummary) {
                        resetBoard()
                        onDismissResults()
                        onDismiss()
                    }
                },
        contentAlignment = Alignment.BottomCenter,
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Bottom,
            modifier =
                Modifier
                    .fillMaxWidth()
                    .background(
                        Color.Black,
                        RoundedCornerShape(topStart = 20.dp, topEnd = 20.dp),
                    ).clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                    ) { /* consume taps on panel */ }
                    .padding(horizontal = 16.dp)
                    .navigationBarsPadding()
                    .padding(bottom = 16.dp),
        ) {
            // Header: [X Close] ---- [History] [Prizes] [Balance pill]
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                IconButton(onClick = {
                    resetBoard()
                    onDismissResults()
                    onDismiss()
                }) {
                    Icon(Icons.Default.Close, contentDescription = stringResource(Res.string.close), tint = Color.White)
                }

                Spacer(modifier = Modifier.weight(1f))

                // History icon
                Surface(
                    shape = RoundedCornerShape(20.dp),
                    color = Color.White.copy(alpha = 0.06f),
                    modifier = Modifier.clickable { showHistory = true },
                ) {
                    Text(
                        "\uD83D\uDCCB",
                        fontSize = 18.sp,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                }

                Spacer(modifier = Modifier.width(8.dp))

                // Prize catalog icon
                Surface(
                    shape = RoundedCornerShape(20.dp),
                    color = Color.White.copy(alpha = 0.06f),
                    modifier = Modifier.clickable { showPrizeList = true },
                ) {
                    Text(
                        "\uD83C\uDFC6",
                        fontSize = 18.sp,
                        modifier = Modifier.padding(horizontal = 10.dp, vertical = 6.dp),
                    )
                }

                Spacer(modifier = Modifier.width(8.dp))

                // Coin balance pill + add button
                Row(verticalAlignment = Alignment.CenterVertically) {
                    Surface(
                        shape = RoundedCornerShape(30.dp),
                        color = Color(0xFFFFD700).copy(alpha = 0.06f),
                    ) {
                        Row(
                            verticalAlignment = Alignment.CenterVertically,
                            modifier = Modifier.padding(horizontal = 18.dp, vertical = 5.dp),
                        ) {
                            Text("\uD83E\uDE99", fontSize = 16.sp)
                            Spacer(modifier = Modifier.width(8.dp))
                            Text(
                                text = "${gachaState.coinBalance}",
                                color = SuperShyGold,
                                fontWeight = FontWeight.ExtraBold,
                                fontSize = 18.sp,
                                letterSpacing = 1.sp,
                            )
                        }
                    }
                    Spacer(modifier = Modifier.width(4.dp))
                    Surface(
                        shape = CircleShape,
                        color = Color(0xFFFFD700).copy(alpha = 0.15f),
                        modifier =
                            Modifier
                                .size(32.dp)
                                .clickable { showCoinShop = true },
                    ) {
                        Box(contentAlignment = Alignment.Center, modifier = Modifier.fillMaxSize()) {
                            Icon(
                                Icons.Default.Add,
                                contentDescription = stringResource(Res.string.buy_coins),
                                tint = SuperShyGold,
                                modifier = Modifier.size(18.dp),
                            )
                        }
                    }
                }
            }

            // Title
            Text(
                text = stringResource(Res.string.lucky_spin_title),
                fontSize = 26.sp,
                fontWeight = FontWeight.Black,
                letterSpacing = 2.sp,
                style =
                    androidx.compose.ui.text.TextStyle(
                        brush =
                            Brush.linearGradient(
                                listOf(
                                    Color(0xFFFFD700),
                                    Color(0xFFFF6B00),
                                    Color(0xFFFF1744),
                                    Color(0xFFD500F9),
                                    Color(0xFF2979FF),
                                    Color(0xFF00E676),
                                ),
                            ),
                    ),
            )

            // Skip animation toggle
            Row(
                verticalAlignment = Alignment.CenterVertically,
                horizontalArrangement = Arrangement.Center,
                modifier =
                    Modifier
                        .graphicsLayer {
                            scaleX = 0.65f
                            scaleY = 0.65f
                        },
            ) {
                Switch(
                    checked = skipAnimation,
                    onCheckedChange = { skipAnimation = it },
                    colors =
                        SwitchDefaults.colors(
                            checkedThumbColor = Color(0xFF1A1A2E),
                            checkedTrackColor = Color(0xFFFFD700),
                            uncheckedThumbColor = Color(0xFF777777),
                            uncheckedTrackColor = Color(0xFF333333),
                        ),
                    modifier = Modifier.height(20.dp),
                )
                Spacer(modifier = Modifier.width(6.dp))
                Text(
                    text = stringResource(Res.string.skip_animation),
                    color = Color.White.copy(alpha = 0.3f),
                    fontSize = 10.sp,
                    fontWeight = FontWeight.SemiBold,
                    letterSpacing = 1.sp,
                )
            }

            Spacer(modifier = Modifier.height(2.dp))

            // Fixed-size area: 1:1 aspect ratio while spinning so the panel
            // doesn't resize; summary popup drops it so content isn't clipped.
            Box(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .padding(horizontal = 8.dp)
                        .then(if (showSummary) Modifier else Modifier.aspectRatio(1f)),
                contentAlignment = Alignment.Center,
            ) {
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
                            phase = SpinPhase.ANIMATING
                            activeTier = tier
                            GachaSoundPlayer.playSpinStart()
                            when (tier.count) {
                                1 -> onSpin()
                                else -> onQuickSpin(tier.count)
                            }
                        },
                    )
                } else {
                    Column(
                        horizontalAlignment = Alignment.CenterHorizontally,
                        verticalArrangement = Arrangement.Center,
                        modifier = Modifier.fillMaxSize(),
                    ) {
                        LuckySpinWheel(
                            outerGifts = outerGifts,
                            innerGifts = innerGifts,
                            outerLitIndex = outerLitIndex,
                            innerLitIndex = innerLitIndex,
                            wonSegments = wonSegments,
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .aspectRatio(1f),
                        )

                        Spacer(modifier = Modifier.height(4.dp))

                        lastWin?.let { win ->
                            if (phase != SpinPhase.IDLE) {
                                Row(
                                    verticalAlignment = Alignment.CenterVertically,
                                    horizontalArrangement = Arrangement.Center,
                                ) {
                                    Text(giftEmoji(win.giftName), fontSize = 22.sp)
                                    Spacer(modifier = Modifier.width(6.dp))
                                    Text(
                                        text = "${win.giftName} — \uD83E\uDE99${win.coinValue}",
                                        color = Color(0xFFFFD700),
                                        fontWeight = FontWeight.ExtraBold,
                                        fontSize = 14.sp,
                                    )
                                }
                                Spacer(modifier = Modifier.height(4.dp))
                            }
                        }
                    }
                }
            }

            // Spin tier buttons — equal height via IntrinsicSize
            if (!gachaState.configLoaded && phase == SpinPhase.IDLE) {
                Text(
                    text = stringResource(Res.string.loading_prices),
                    color = Color.White.copy(alpha = 0.5f),
                    fontSize = 14.sp,
                )
            } else if (gachaState.configLoaded) {
                val spinning = phase == SpinPhase.ANIMATING || phase == SpinPhase.CELEBRATING
                Row(
                    horizontalArrangement = Arrangement.spacedBy(10.dp),
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .height(IntrinsicSize.Min),
                ) {
                    spinTiers.forEach { tier ->
                        val canAfford = gachaState.coinBalance >= tier.cost

                        Button(
                            onClick = {
                                if (spinning || showSummary) return@Button
                                if (!canAfford) {
                                    showCoinShop = true
                                } else if (!gachaState.isPulling) {
                                    activeTier = tier
                                    phase = SpinPhase.ANIMATING
                                    wonSegments = emptySet()
                                    outerLitIndex = -1
                                    innerLitIndex = -1
                                    lastWin = null
                                    showConfetti = false
                                    allWins = emptyList()
                                    GachaSoundPlayer.playSpinStart()
                                    when (tier.count) {
                                        1 -> onSpin()
                                        else -> onQuickSpin(tier.count)
                                    }
                                }
                            },
                            colors =
                                ButtonDefaults.buttonColors(
                                    containerColor = tier.color.copy(alpha = 0.15f),
                                ),
                            shape = RoundedCornerShape(20.dp),
                            contentPadding = ButtonDefaults.ContentPadding,
                            modifier =
                                Modifier
                                    .weight(1f)
                                    .heightIn(min = 72.dp),
                        ) {
                            Column(
                                horizontalAlignment = Alignment.CenterHorizontally,
                                modifier = Modifier.fillMaxWidth(),
                            ) {
                                Text(
                                    text = tier.label,
                                    fontSize = 18.sp,
                                    fontWeight = FontWeight.Black,
                                    color = tier.color,
                                    letterSpacing = 1.sp,
                                    lineHeight = 20.sp,
                                    maxLines = 1,
                                )
                                Text(
                                    text = stringResource(Res.string.spin),
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Bold,
                                    color = Color.White.copy(alpha = 0.55f),
                                    letterSpacing = 1.sp,
                                    maxLines = 1,
                                )
                                Surface(
                                    shape = RoundedCornerShape(12.dp),
                                    color = tier.color.copy(alpha = 0.12f),
                                ) {
                                    Row(
                                        verticalAlignment = Alignment.CenterVertically,
                                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 2.dp),
                                    ) {
                                        Text("\uD83E\uDE99", fontSize = 11.sp, maxLines = 1)
                                        Text(
                                            text = "${tier.cost}",
                                            fontSize = 11.sp,
                                            fontWeight = FontWeight.ExtraBold,
                                            color = tier.color,
                                            maxLines = 1,
                                        )
                                    }
                                }
                                // All buttons show the drop rate line — visible text only for boosted tier
                                Text(
                                    text = if (tier.boostedDrop) stringResource(Res.string.increased_drop_rate) else "",
                                    fontSize = 7.sp,
                                    fontWeight = FontWeight.ExtraBold,
                                    letterSpacing = 0.sp,
                                    color = tier.color,
                                    maxLines = 1,
                                    lineHeight = 9.sp,
                                    overflow = androidx.compose.ui.text.style.TextOverflow.Visible,
                                    softWrap = false,
                                )
                            }
                        }
                    }
                }
            }

            // Collect All button when celebrating (pre-summary)
            if (phase == SpinPhase.CELEBRATING && wonSegments.isNotEmpty() && !showSummary) {
                Spacer(modifier = Modifier.height(8.dp))
                Button(
                    onClick = {
                        showSummary = true
                        phase = SpinPhase.SHOW_SUMMARY
                    },
                    colors =
                        ButtonDefaults.buttonColors(
                            containerColor = Color(0xFFFFD700).copy(alpha = 0.08f),
                        ),
                    shape = RoundedCornerShape(50),
                ) {
                    Text(
                        text = stringResource(Res.string.collect_all, allWins.size),
                        color = Color(0xFFFFD700),
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 14.sp,
                        letterSpacing = 2.sp,
                    )
                }
            }
        }

        // Confetti overlay
        LuckySpinConfetti(
            active = showConfetti,
            particleCount = confettiCount,
            modifier = Modifier.fillMaxSize(),
        )

        // Screen flash overlay
        if (showFlash) {
            Box(
                modifier =
                    Modifier
                        .fillMaxSize()
                        .background(flashColor),
            )
        }

        // Inline Coin Shop overlay
        if (showCoinShop) {
            InlineCoinShop(
                coinPackages = gachaState.coinPackages,
                coinBalance = gachaState.coinBalance,
                onPurchase = { coins ->
                    GachaSoundPlayer.playCoinPurchase()
                    onTestPurchase(coins)
                },
                onDismiss = { showCoinShop = false },
            )
        }

        // Inline Spin History overlay
        if (showHistory) {
            InlineSpinHistory(
                transactions = gachaState.spinHistory,
                gifts = gachaState.winnableGifts,
                onDismiss = { showHistory = false },
            )
        }

        // Inline Prize Catalog overlay
        if (showPrizeList) {
            InlinePrizeCatalog(
                gifts = gachaState.winnableGifts,
                onDismiss = { showPrizeList = false },
            )
        }
    }
}

@Composable
private fun InlineCoinShop(
    coinPackages: List<CoinPackage>,
    coinBalance: Long,
    onPurchase: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    Box(
        modifier =
            Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.85f))
                .clickable(
                    indication = null,
                    interactionSource = remember { MutableInteractionSource() },
                ) { /* consume taps */ },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(Res.string.need_more_coins),
                    color = Color(0xFFFFD700),
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 20.sp,
                )
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = stringResource(Res.string.close), tint = Color.White)
                }
            }

            Text(
                text = "\uD83E\uDE99 $coinBalance",
                color = Color.White.copy(alpha = 0.7f),
                fontSize = 14.sp,
                fontWeight = FontWeight.Bold,
            )

            Spacer(modifier = Modifier.height(12.dp))

            if (coinPackages.isEmpty()) {
                Text(
                    text = stringResource(Res.string.no_packages_available),
                    color = Color.White.copy(alpha = 0.5f),
                    fontSize = 14.sp,
                )
            } else {
                LazyVerticalGrid(
                    columns = GridCells.Fixed(2),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.heightIn(max = 260.dp),
                ) {
                    items(coinPackages) { pkg ->
                        CoinPackageCard(
                            pkg = pkg,
                            onClick = { onPurchase(pkg.totalCoins) },
                        )
                    }
                }
            }
        }
    }
}

@Composable
private fun InlineSpinHistory(
    transactions: List<Transaction>,
    gifts: List<Gift>,
    onDismiss: () -> Unit,
) {
    val iconLookup = remember(gifts) { gifts.associateBy({ it.name }, { it.iconUrl }) }
    val sorted = remember(transactions) { transactions.sortedByDescending { it.timestamp } }

    Box(
        modifier =
            Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.6f))
                .clickable(
                    indication = null,
                    interactionSource = remember { MutableInteractionSource() },
                ) { onDismiss() },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth(0.9f)
                    .fillMaxHeight(0.55f)
                    .background(Color(0xFF1A1A2E), RoundedCornerShape(16.dp))
                    .clickable(
                        indication = null,
                        interactionSource = remember { MutableInteractionSource() },
                    ) { /* consume taps on panel */ }
                    .padding(16.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(Res.string.spin_history),
                    color = Color.White,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 20.sp,
                )
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = stringResource(Res.string.close), tint = Color.White)
                }
            }

            Spacer(modifier = Modifier.height(8.dp))

            if (sorted.isEmpty()) {
                Text(
                    text = stringResource(Res.string.no_spins_yet),
                    color = Color.White.copy(alpha = 0.5f),
                    fontSize = 14.sp,
                )
            } else {
                Column(
                    verticalArrangement = Arrangement.spacedBy(6.dp),
                    modifier =
                        Modifier
                            .fillMaxWidth()
                            .weight(1f)
                            .verticalScroll(rememberScrollState()),
                ) {
                    sorted.forEach { tx ->
                        val giftNames =
                            tx.details
                                ?.split(",")
                                ?.map { it.trim() }
                                ?.filter { it.isNotBlank() }
                                ?: emptyList()

                        Row(
                            modifier =
                                Modifier
                                    .fillMaxWidth()
                                    .background(Color.White.copy(alpha = 0.06f), RoundedCornerShape(8.dp))
                                    .padding(horizontal = 10.dp, vertical = 8.dp),
                            verticalAlignment = Alignment.CenterVertically,
                        ) {
                            // Pull count badge
                            val pulls = tx.pullCount ?: 1
                            Box(
                                modifier =
                                    Modifier
                                        .size(28.dp)
                                        .background(Color(0xFFE53935), RoundedCornerShape(6.dp)),
                                contentAlignment = Alignment.Center,
                            ) {
                                Text(
                                    "${pulls}x",
                                    fontSize = 10.sp,
                                    fontWeight = FontWeight.Black,
                                    color = Color.White,
                                )
                            }

                            Spacer(modifier = Modifier.width(8.dp))

                            // Gift icons row + names
                            Column(modifier = Modifier.weight(1f)) {
                                if (giftNames.isNotEmpty()) {
                                    // Show gift icons in a row (max 10 visible)
                                    Row(horizontalArrangement = Arrangement.spacedBy(2.dp)) {
                                        giftNames.take(10).forEach { name ->
                                            val url = iconLookup[name]
                                            if (url != null && url.isNotBlank()) {
                                                AsyncImage(
                                                    model = url,
                                                    contentDescription = name,
                                                    modifier =
                                                        Modifier
                                                            .size(22.dp)
                                                            .clip(CircleShape),
                                                    contentScale = ContentScale.Crop,
                                                )
                                            } else {
                                                Text(giftEmoji(name), fontSize = 14.sp)
                                            }
                                        }
                                        if (giftNames.size > 10) {
                                            Text(
                                                "+${giftNames.size - 10}",
                                                fontSize = 10.sp,
                                                color = Color.White.copy(alpha = 0.5f),
                                                modifier = Modifier.align(Alignment.CenterVertically),
                                            )
                                        }
                                    }
                                    // Gift names summary
                                    val grouped = giftNames.groupingBy { it }.eachCount()
                                    val summary =
                                        grouped.entries
                                            .sortedByDescending { it.value }
                                            .joinToString(", ") { (name, count) ->
                                                if (count > 1) "${count}x $name" else name
                                            }
                                    Text(
                                        text = summary,
                                        color = Color.White.copy(alpha = 0.7f),
                                        fontSize = 10.sp,
                                        maxLines = 2,
                                        overflow = TextOverflow.Ellipsis,
                                    )
                                } else {
                                    Text(
                                        "${pulls}x Pull",
                                        color = Color.White.copy(alpha = 0.7f),
                                        fontSize = 11.sp,
                                    )
                                }
                            }

                            // Cost
                            Text(
                                text = "\uD83E\uDE99 ${kotlin.math.abs(tx.amount)}",
                                color = Color(0xFFFFD700),
                                fontSize = 10.sp,
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    }
                }
            }
        }
    }
}

@Composable
private fun InlinePrizeCatalog(
    gifts: List<Gift>,
    onDismiss: () -> Unit,
) {
    val sorted =
        remember(gifts) {
            gifts.sortedByDescending { it.coinValue }
        }

    Box(
        modifier =
            Modifier
                .fillMaxSize()
                .background(Color.Black.copy(alpha = 0.9f))
                .clickable(
                    indication = null,
                    interactionSource = remember { MutableInteractionSource() },
                ) { /* consume taps */ },
        contentAlignment = Alignment.Center,
    ) {
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .padding(24.dp),
        ) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.SpaceBetween,
                verticalAlignment = Alignment.CenterVertically,
            ) {
                Text(
                    text = stringResource(Res.string.prizes),
                    color = Color.White,
                    fontWeight = FontWeight.ExtraBold,
                    fontSize = 20.sp,
                )
                IconButton(onClick = onDismiss) {
                    Icon(Icons.Default.Close, contentDescription = stringResource(Res.string.close), tint = Color.White)
                }
            }

            Spacer(modifier = Modifier.height(12.dp))

            Column(
                verticalArrangement = Arrangement.spacedBy(4.dp),
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .weight(1f, fill = false)
                        .verticalScroll(rememberScrollState()),
            ) {
                sorted.chunked(4).forEach { row ->
                    Row(
                        horizontalArrangement = Arrangement.spacedBy(4.dp),
                        modifier = Modifier.fillMaxWidth(),
                    ) {
                        row.forEach { gift ->
                            Box(modifier = Modifier.weight(1f)) {
                                Box(
                                    modifier =
                                        Modifier
                                            .aspectRatio(1f)
                                            .background(
                                                Color(0xFF9E9E9E).copy(alpha = 0.1f),
                                                RoundedCornerShape(8.dp),
                                            ).padding(4.dp),
                                    contentAlignment = Alignment.Center,
                                ) {
                                    Column(
                                        horizontalAlignment = Alignment.CenterHorizontally,
                                        verticalArrangement = Arrangement.Center,
                                        modifier = Modifier.fillMaxSize(),
                                    ) {
                                        if (gift.iconUrl.isNotBlank()) {
                                            AsyncImage(
                                                model = gift.iconUrl,
                                                contentDescription = gift.name,
                                                modifier = Modifier.size(36.dp),
                                            )
                                        } else {
                                            Text(giftEmoji(gift.name), fontSize = 24.sp)
                                        }
                                        Text(
                                            text = gift.name,
                                            color = Color.White,
                                            fontSize = 9.sp,
                                            fontWeight = FontWeight.Bold,
                                            textAlign = TextAlign.Center,
                                            maxLines = 1,
                                            overflow = TextOverflow.Ellipsis,
                                        )
                                        Text(
                                            text = "\uD83E\uDE99 ${gift.coinValue}",
                                            color = Color(0xFFFFD700),
                                            fontSize = 8.sp,
                                            fontWeight = FontWeight.ExtraBold,
                                            maxLines = 1,
                                        )
                                    }
                                }
                            }
                        }
                        repeat(4 - row.size) {
                            Spacer(modifier = Modifier.weight(1f))
                        }
                    }
                }
            }
        }
    }
}
