package com.shyden.shytalk.feature.gacha

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.spring
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
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
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.GachaGift
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.*
import org.jetbrains.compose.resources.stringResource

private data class GroupedWin(
    val giftId: String,
    val giftName: String,
    val coinValue: Int,
    val count: Int,
    val iconUrl: String = ""
)

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

    // Animated entrance
    var appeared by remember { mutableStateOf(false) }
    LaunchedEffect(Unit) { appeared = true }
    val scale by animateFloatAsState(
        targetValue = if (appeared) 1f else 0.5f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow),
        label = "summaryScale"
    )

    Surface(
        modifier = Modifier
            .fillMaxWidth()
            .graphicsLayer {
                scaleX = scale
                scaleY = scale
            },
        shape = RoundedCornerShape(20.dp),
        color = Color(0xFF1A1A3E).copy(alpha = 0.6f),
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            modifier = Modifier.padding(horizontal = 10.dp, vertical = 10.dp)
        ) {
                // Title
                Text(
                    text = stringResource(Res.string.spin_results),
                    fontSize = 18.sp,
                    fontWeight = FontWeight.Black,
                    color = Color.White,
                    letterSpacing = 2.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Text(
                    text = stringResource(Res.string.spin_count, wins.size) + (if (spinTier.boostedDrop) "  \u2605 " + stringResource(Res.string.increased_drop_rate) else ""),
                    color = Color.White.copy(alpha = 0.35f),
                    fontSize = 10.sp,
                    letterSpacing = 2.sp,
                    maxLines = 1,
                    overflow = TextOverflow.Ellipsis
                )

                Spacer(modifier = Modifier.height(8.dp))

                // Gift cards grid — 4 columns with perfect squares
                Column(
                    verticalArrangement = Arrangement.spacedBy(4.dp),
                    modifier = Modifier
                        .fillMaxWidth()
                        .verticalScroll(rememberScrollState())
                ) {
                    grouped.chunked(4).forEach { row ->
                        Row(
                            horizontalArrangement = Arrangement.spacedBy(4.dp),
                            modifier = Modifier.fillMaxWidth()
                        ) {
                            row.forEachIndexed { index, win ->
                                Box(modifier = Modifier.weight(1f)) {
                                    WinCard(win = win, index = index)
                                }
                            }
                            // Fill remaining slots with spacers
                            repeat(4 - row.size) {
                                Spacer(modifier = Modifier.weight(1f))
                            }
                        }
                    }
                }

                Spacer(modifier = Modifier.height(10.dp))

                // Total coins
                Text(
                    text = "\uD83E\uDE99 ${totalCoins.formatWithCommas()} " + stringResource(Res.string.coins),
                    fontSize = 20.sp,
                    fontWeight = FontWeight.Black,
                    style = MaterialTheme.typography.headlineLarge.copy(
                        brush = Brush.linearGradient(
                            listOf(Color(0xFFFFD700), Color(0xFFFF9100))
                        )
                    )
                )

                Spacer(modifier = Modifier.height(12.dp))

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
                        .height(40.dp)
                ) {
                    Text(
                        text = stringResource(Res.string.spin_again_with_cost, spinTier.label, spinTier.cost),
                        fontWeight = FontWeight.ExtraBold,
                        fontSize = 13.sp,
                        letterSpacing = 2.sp,
                        color = if (canAffordSpinAgain) Color.White else Color.Gray
                    )
                }

                Spacer(modifier = Modifier.height(6.dp))

                // Close button
                Button(
                    onClick = onClose,
                    colors = ButtonDefaults.buttonColors(
                        containerColor = Color.White.copy(alpha = 0.08f)
                    ),
                    shape = RoundedCornerShape(50),
                    modifier = Modifier
                        .fillMaxWidth(0.6f)
                        .height(34.dp)
                ) {
                    Text(
                        text = stringResource(Res.string.close),
                        color = Color.White.copy(alpha = 0.6f),
                        fontWeight = FontWeight.Bold,
                        fontSize = 12.sp
                    )
                }
            }
        }
}

@Composable
private fun WinCard(win: GroupedWin, index: Int) {
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
            .aspectRatio(1f)
            .graphicsLayer { scaleX = scale; scaleY = scale }
            .clip(RoundedCornerShape(8.dp))
            .background(Color(0xFF9E9E9E).copy(alpha = 0.1f))
            .padding(2.dp),
        contentAlignment = Alignment.Center
    ) {
        Column(
            horizontalAlignment = Alignment.CenterHorizontally,
            verticalArrangement = Arrangement.Center,
            modifier = Modifier.fillMaxSize()
        ) {
            if (win.iconUrl.isNotBlank()) {
                AsyncImage(
                    model = win.iconUrl,
                    contentDescription = win.giftName,
                    modifier = Modifier.size(28.dp)
                )
            } else {
                Text(
                    text = giftEmoji(win.giftName),
                    fontSize = 20.sp
                )
            }

            Text(
                text = win.giftName,
                color = Color.White,
                fontSize = 8.sp,
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )

            Text(
                text = "\uD83E\uDE99${win.coinValue.formatWithCommas()}",
                color = Color(0xFFFFD700),
                fontSize = 7.sp,
                fontWeight = FontWeight.ExtraBold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis
            )
        }

        // Overlapping quantity badge at top-end
        if (win.count > 1) {
            Box(
                modifier = Modifier
                    .align(Alignment.TopEnd)
                    .size(18.dp)
                    .clip(RoundedCornerShape(9.dp))
                    .background(Color(0xFFE53935)),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = "x${win.count}",
                    fontSize = 7.sp,
                    fontWeight = FontWeight.Black,
                    color = Color.White
                )
            }
        }
    }
}

private fun Int.formatWithCommas(): String {
    val numStr = this.toString()
    val result = StringBuilder()
    for ((i, c) in numStr.reversed().withIndex()) {
        if (i > 0 && i % 3 == 0) result.append(',')
        result.append(c)
    }
    return result.reverse().toString()
}
