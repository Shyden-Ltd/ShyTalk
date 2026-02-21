package com.shyden.shytalk.feature.gacha

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.interaction.MutableInteractionSource
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.ExperimentalLayoutApi
import androidx.compose.foundation.layout.FlowRow
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.GachaGift

private data class GroupedWin(
    val giftId: String,
    val giftName: String,
    val coinValue: Int,
    val count: Int,
    val iconUrl: String = ""
)

@OptIn(ExperimentalLayoutApi::class)
@Composable
fun LuckySpinSummaryPopup(
    wins: List<GachaGift>,
    spinTier: SpinTier,
    canAffordSpinAgain: Boolean,
    onClose: () -> Unit,
    onSpinAgain: () -> Unit
) {
    val grouped = remember(wins) {
        val map = mutableMapOf<String, GroupedWin>()
        for (w in wins) {
            val existing = map[w.giftId]
            if (existing != null) {
                map[w.giftId] = existing.copy(count = existing.count + 1)
            } else {
                map[w.giftId] = GroupedWin(w.giftId, w.giftName, w.coinValue, 1, w.iconUrl)
            }
        }
        map.values
            .sortedWith(compareByDescending<GroupedWin> { it.coinValue })
            .toList()
    }

    val totalCoins = remember(wins) { wins.sumOf { it.coinValue } }
    val bestCoinValue = remember(wins) {
        wins.maxByOrNull { it.coinValue }?.coinValue ?: 0
    }
    val rarityConfig = rarityConfigForCoinValue(bestCoinValue)
    val isHighValue = bestCoinValue >= 2000

    // Animated entrance
    var appeared by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { appeared = true }
    val scale by animateFloatAsState(
        targetValue = if (appeared) 1f else 0.5f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow),
        label = "summaryScale"
    )

    Box(
        modifier = Modifier
            .fillMaxSize()
            .background(Color.Black)
            .clickable(
                indication = null,
                interactionSource = remember { MutableInteractionSource() }
            ) { /* consume taps */ },
        contentAlignment = Alignment.Center
    ) {
        Surface(
            modifier = Modifier
                .widthIn(max = 420.dp)
                .fillMaxWidth(0.94f)
                .graphicsLayer {
                    scaleX = scale
                    scaleY = scale
                },
            shape = RoundedCornerShape(28.dp),
            color = Color(0xFF1A1A3E),
            shadowElevation = 16.dp
        ) {
            Column(
                horizontalAlignment = Alignment.CenterHorizontally,
                modifier = Modifier.padding(horizontal = 24.dp, vertical = 32.dp)
            ) {
                // Title
                Text(
                    text = if (isHighValue) rarityConfig.title else "Spin Results",
                    fontSize = if (isHighValue) 26.sp else 22.sp,
                    fontWeight = FontWeight.Black,
                    color = rarityConfig.glowColor,
                    letterSpacing = 2.sp
                )

                Text(
                    text = "${wins.size} SPIN${if (wins.size > 1) "S" else ""}${if (spinTier.boostedDrop) "  \u2605 INCREASED DROP RATE" else ""}",
                    color = Color.White.copy(alpha = 0.35f),
                    fontSize = 11.sp,
                    letterSpacing = 2.sp
                )

                Spacer(modifier = Modifier.height(14.dp))

                // Gift cards grid
                FlowRow(
                    horizontalArrangement = Arrangement.spacedBy(8.dp, Alignment.CenterHorizontally),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .height(if (grouped.size > 8) 200.dp else 140.dp)
                        .verticalScroll(rememberScrollState())
                ) {
                    grouped.forEachIndexed { index, win ->
                        WinCard(win = win, index = index)
                    }
                }

                Spacer(modifier = Modifier.height(16.dp))

                // Total coins
                Text(
                    text = "\uD83E\uDE99 ${totalCoins.formatWithCommas()} Coins",
                    fontSize = if (isHighValue) 34.sp else 26.sp,
                    fontWeight = FontWeight.Black,
                    style = MaterialTheme.typography.headlineLarge.copy(
                        brush = if (bestCoinValue >= 10000) {
                            Brush.linearGradient(
                                listOf(Color(0xFFFFD700), Color(0xFFFF6B00), Color(0xFFFF1744), Color(0xFFFFD700))
                            )
                        } else {
                            Brush.linearGradient(
                                listOf(Color(0xFFFFD700), Color(0xFFFF9100))
                            )
                        }
                    )
                )

                Spacer(modifier = Modifier.height(18.dp))

                // Spin again button
                Button(
                    onClick = onSpinAgain,
                    enabled = canAffordSpinAgain,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = spinTier.accentColor,
                        disabledContainerColor = Color(0xFF333333)
                    ),
                    shape = RoundedCornerShape(50),
                    modifier = Modifier
                        .fillMaxWidth(0.8f)
                        .height(48.dp)
                ) {
                    Text(
                        text = "${spinTier.label} SPIN AGAIN \u00B7 \uD83E\uDE99${spinTier.cost}",
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 15.sp,
                        letterSpacing = 2.sp,
                        color = if (canAffordSpinAgain) Color.White else Color.Gray
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                // Close button
                Button(
                    onClick = onClose,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color.White.copy(alpha = 0.08f)
                    ),
                    shape = RoundedCornerShape(50),
                    modifier = Modifier
                        .fillMaxWidth(0.6f)
                        .height(40.dp)
                ) {
                    Text(
                        text = "Close",
                        color = Color.White.copy(alpha = 0.6f),
                        fontWeight = FontWeight.Bold,
                        fontSize = 13.sp
                    )
                }
            }
        }
    }
}

@Composable
private fun WinCard(win: GroupedWin, index: Int) {
    val isHighValue = win.coinValue >= 2000

    // Staggered entrance
    var appeared by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { appeared = true }
    val scale by animateFloatAsState(
        targetValue = if (appeared) 1f else 0f,
        animationSpec = spring(
            dampingRatio = Spring.DampingRatioMediumBouncy,
            stiffness = Spring.StiffnessLow
        ),
        label = "cardScale$index"
    )

    val cardColor = Color(0xFF9E9E9E)

    Box(
        modifier = Modifier
            .size(width = 80.dp, height = 110.dp)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(RoundedCornerShape(16.dp))
            .background(cardColor.copy(alpha = 0.1f))
            .padding(horizontal = 4.dp, vertical = 6.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier.fillMaxSize()
        ) {
            // Count badge — always reserve space
            Text(
                text = if (win.count > 1) "x${win.count}" else "",
                fontSize = 10.sp,
                fontWeight = FontWeight.Black,
                color = if (win.count > 1) Color(0xFF1A1A2E) else Color.Transparent,
                modifier = Modifier
                    .clip(RoundedCornerShape(10.dp))
                    .then(
                        if (win.count > 1) Modifier.background(
                            Brush.linearGradient(listOf(Color(0xFFFFD700), Color(0xFFFF9100)))
                        ) else Modifier
                    )
                    .padding(horizontal = 7.dp, vertical = 1.dp)
            )

            if (win.iconUrl.isNotBlank()) {
                AsyncImage(
                    model = win.iconUrl,
                    contentDescription = win.giftName,
                    modifier = Modifier.size(36.dp)
                )
            } else {
                Text(
                    text = giftEmoji(win.giftName),
                    fontSize = 28.sp
                )
            }

            Text(
                text = win.giftName,
                color = Color.White,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                maxLines = 1
            )

            Text(
                text = "\uD83E\uDE99 ${win.coinValue.formatWithCommas()}",
                color = Color(0xFFFFD700),
                fontSize = 11.sp,
                fontWeight = FontWeight.ExtraBold,
                maxLines = 1
            )

            // High-value label — always reserve space
            Text(
                text = if (isHighValue) "HIGH VALUE" else "",
                fontSize = 7.sp,
                fontWeight = FontWeight.ExtraBold,
                letterSpacing = 1.5.sp,
                color = if (isHighValue) rarityConfigForCoinValue(win.coinValue).glowColor else Color.Transparent
            )
        }
    }
}

private fun Int.formatWithCommas(): String {
    val s = this.toString()
    val result = StringBuilder()
    for ((i, c) in s.reversed().withIndex()) {
        if (i > 0 && i % 3 == 0) result.append(',')
        result.append(c)
    }
    return result.reverse().toString()
}
