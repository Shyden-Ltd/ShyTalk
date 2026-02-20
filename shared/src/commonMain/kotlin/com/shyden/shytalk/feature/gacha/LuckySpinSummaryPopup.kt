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
import com.shyden.shytalk.core.model.GachaGift
import com.shyden.shytalk.core.model.GiftBracket

private data class GroupedWin(
    val giftId: String,
    val giftName: String,
    val bracket: GiftBracket,
    val coinValue: Int,
    val count: Int
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
                map[w.giftId] = GroupedWin(w.giftId, w.giftName, w.bracket, w.coinValue, 1)
            }
        }
        map.values
            .sortedWith(compareByDescending<GroupedWin> { it.bracket.ordinal }.thenByDescending { it.coinValue })
            .toList()
    }

    val totalCoins = remember(wins) { wins.sumOf { it.coinValue } }
    val bestBracket = remember(wins) {
        wins.maxByOrNull { it.bracket.ordinal }?.bracket ?: GiftBracket.COMMON
    }
    val rarityConfig = RarityConfigs[bestBracket] ?: RarityConfigs[GiftBracket.COMMON]!!
    val isRarePlus = bestBracket.ordinal >= GiftBracket.RARE.ordinal

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
                    text = if (isRarePlus) rarityConfig.title else "Spin Results",
                    fontSize = if (isRarePlus) 26.sp else 22.sp,
                    fontWeight = FontWeight.Black,
                    color = rarityConfig.glowColor,
                    letterSpacing = 2.sp
                )

                Text(
                    text = "${wins.size} SPIN${if (wins.size > 1) "S" else ""}${if (spinTier.boostedDrop) "  ★ BOOSTED" else ""}",
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
                    fontSize = if (isRarePlus) 34.sp else 26.sp,
                    fontWeight = FontWeight.Black,
                    style = MaterialTheme.typography.headlineLarge.copy(
                        brush = if (bestBracket == GiftBracket.LEGENDARY) {
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
                        containerColor = spinTier.color,
                        disabledContainerColor = Color(0xFF333333)
                    ),
                    shape = RoundedCornerShape(50),
                    modifier = Modifier
                        .fillMaxWidth(0.8f)
                        .height(48.dp)
                ) {
                    Text(
                        text = "${spinTier.label} SPIN AGAIN · \uD83E\uDE99${spinTier.cost}",
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
    val bracketColor = BracketColors[win.bracket] ?: Color.Gray
    val isRarePlus = win.bracket.ordinal >= GiftBracket.RARE.ordinal

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

    Box(
        modifier = Modifier
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(RoundedCornerShape(16.dp))
            .background(bracketColor.copy(alpha = 0.1f))
            .padding(horizontal = 12.dp, vertical = 8.dp)
            .widthIn(min = 80.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            // Count badge
            if (win.count > 1) {
                Text(
                    text = "x${win.count}",
                    fontSize = 10.sp,
                    fontWeight = FontWeight.Black,
                    color = Color(0xFF1A1A2E),
                    modifier = Modifier
                        .clip(RoundedCornerShape(10.dp))
                        .background(
                            Brush.linearGradient(listOf(Color(0xFFFFD700), Color(0xFFFF9100)))
                        )
                        .padding(horizontal = 7.dp, vertical = 1.dp)
                )
            }

            Text(
                text = giftEmoji(win.giftName),
                fontSize = 28.sp
            )

            Text(
                text = win.giftName,
                color = Color.White,
                fontSize = 10.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                maxLines = 1
            )

            Text(
                text = "\uD83E\uDE99 ${(win.coinValue * win.count).formatWithCommas()}",
                color = Color(0xFFFFD700),
                fontSize = 11.sp,
                fontWeight = FontWeight.ExtraBold
            )

            if (isRarePlus) {
                Text(
                    text = win.bracket.name,
                    fontSize = 7.sp,
                    fontWeight = FontWeight.ExtraBold,
                    letterSpacing = 1.5.sp,
                    color = (RarityConfigs[win.bracket] ?: RarityConfigs[GiftBracket.COMMON]!!).glowColor
                )
            }
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
