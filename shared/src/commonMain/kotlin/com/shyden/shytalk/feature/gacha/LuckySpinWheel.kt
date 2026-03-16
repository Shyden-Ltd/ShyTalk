package com.shyden.shytalk.feature.gacha

import androidx.compose.foundation.Canvas
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import androidx.compose.ui.Modifier
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.DrawScope
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.TextMeasurer
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.drawText
import androidx.compose.ui.text.rememberTextMeasurer
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Constraints
import androidx.compose.ui.unit.sp
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.min
import kotlin.math.sin

/** Neutral segment color for all gifts (rarity removed). */
private val SegmentColor = Color(0xFF9E9E9E)
private val SegmentAccentColor = Color(0xFF757575)

enum class Ring { OUTER, INNER }

/**
 * Splits winnable gifts into outer (below [innerThreshold]) and inner (at or above)
 * rings, sorted by [Gift.order].
 */
fun buildRingLayout(
    gifts: List<Gift>,
    innerThreshold: Int = 18888,
): Pair<List<Gift>, List<Gift>> {
    val outer =
        gifts
            .filter { it.coinValue < innerThreshold }
            .sortedBy { it.order }
    val inner =
        gifts
            .filter { it.coinValue >= innerThreshold }
            .sortedBy { it.order }
    return outer to inner
}

/**
 * Finds which ring and segment index a gift with [giftId] occupies.
 */
fun resolveWinPosition(
    giftId: String,
    outerGifts: List<Gift>,
    innerGifts: List<Gift>,
): Pair<Ring, Int>? {
    val outerIndex = outerGifts.indexOfFirst { it.id == giftId }
    if (outerIndex >= 0) return Ring.OUTER to outerIndex
    val innerIndex = innerGifts.indexOfFirst { it.id == giftId }
    if (innerIndex >= 0) return Ring.INNER to innerIndex
    return null
}

private val GiftEmojiMap =
    mapOf(
        "Rose" to "\uD83C\uDF39",
        "Candy" to "\uD83C\uDF6C",
        "Heart" to "\u2764\uFE0F",
        "Star" to "\u2B50",
        "Clover" to "\uD83C\uDF40",
        "Fire" to "\uD83D\uDD25",
        "Moon" to "\uD83C\uDF19",
        "Bolt" to "\u26A1",
        "Gift Box" to "\uD83C\uDF81",
        "Potion" to "\uD83E\uDDEA",
        "Crown" to "\uD83D\uDC51",
        "Treasure" to "\uD83D\uDCB0",
        "Mystery" to "\uD83D\uDD2E",
        "Jackpot" to "\uD83C\uDFB0",
        "Multiplier" to "\u2716\uFE0F",
        "Bonus" to "\uD83C\uDFAF",
        "Ruby" to "\uD83D\uDC8E",
        "Sunflower" to "\uD83C\uDF3B",
        "Coffee" to "\u2615",
        "Music Note" to "\uD83C\uDFB5",
        "Balloon" to "\uD83C\uDF88",
        "Cake" to "\uD83C\uDF82",
        "Diamond" to "\uD83D\uDC8E",
        "Rocket" to "\uD83D\uDE80",
        "Trophy" to "\uD83C\uDFC6",
        "Rainbow" to "\uD83C\uDF08",
        "Unicorn" to "\uD83E\uDD84",
    )

fun giftEmoji(name: String): String = GiftEmojiMap[name] ?: name.take(2)

private fun formatCoins(n: Int): String =
    when {
        n >= 1000 -> "${n / 1000}${if (n % 1000 != 0) ".${(n % 1000) / 100}" else ""}K"
        else -> "$n"
    }

@Composable
fun LuckySpinWheel(
    outerGifts: List<Gift>,
    innerGifts: List<Gift>,
    outerLitIndex: Int,
    innerLitIndex: Int,
    wonSegments: Set<String>,
    modifier: Modifier = Modifier,
) {
    val textMeasurer = rememberTextMeasurer()
    val spinText = stringResource(Res.string.spin)
    val outerAngle =
        remember(outerGifts.size) {
            if (outerGifts.isNotEmpty()) 360f / outerGifts.size else 0f
        }
    val innerAngle =
        remember(innerGifts.size) {
            if (innerGifts.isNotEmpty()) 360f / innerGifts.size else 0f
        }

    Canvas(
        modifier =
            modifier
                .fillMaxSize()
                .aspectRatio(1f),
    ) {
        val diameter = min(size.width, size.height)
        val radius = diameter / 2f
        val center = Offset(size.width / 2f, size.height / 2f)

        // Outer border ring
        drawCircle(Color(0xFFFFD600).copy(alpha = 0.07f), radius = radius, center = center)
        drawCircle(Color(0xFFFFD600).copy(alpha = 0.12f), radius = radius, center = center, style = Stroke(3f))

        // Outer ring: from radius to ~62% radius
        val outerRingOuter = radius - 6f
        val outerRingInner = radius * 0.62f
        drawRing(
            gifts = outerGifts,
            segmentAngle = outerAngle,
            rOuter = outerRingOuter,
            rInner = outerRingInner,
            litIndex = outerLitIndex,
            ringName = "outer",
            wonSegments = wonSegments,
            center = center,
            textMeasurer = textMeasurer,
        )

        // Divider between rings
        drawCircle(Color(0xFF0D0D1A), radius = outerRingInner + 2f, center = center, style = Stroke(5f))
        drawCircle(Color(0xFFFFD700).copy(alpha = 0.08f), radius = outerRingInner, center = center, style = Stroke(1f))

        // Inner ring: from ~60% to ~28% radius
        val innerRingOuter = outerRingInner - 3f
        val innerRingInner = radius * 0.28f
        drawRing(
            gifts = innerGifts,
            segmentAngle = innerAngle,
            rOuter = innerRingOuter,
            rInner = innerRingInner,
            litIndex = innerLitIndex,
            ringName = "inner",
            wonSegments = wonSegments,
            center = center,
            textMeasurer = textMeasurer,
        )

        // Center hub
        drawCircle(Color(0xFF0D0D1A), radius = innerRingInner, center = center)
        drawCircle(Color(0xFFFFD700).copy(alpha = 0.1f), radius = innerRingInner, center = center, style = Stroke(1.5f))

        // Center "SPIN" text
        val spinLabel =
            textMeasurer.measure(
                text = spinText,
                style =
                    TextStyle(
                        color = Color(0xFFFFD700).copy(alpha = 0.3f),
                        fontSize = (innerRingInner * 0.21f / density / fontScale).sp,
                        letterSpacing = (innerRingInner * 0.04f / density / fontScale).sp,
                    ),
                constraints = Constraints(maxWidth = (innerRingInner * 2).toInt().coerceAtLeast(1)),
            )
        drawText(
            textLayoutResult = spinLabel,
            topLeft =
                Offset(
                    center.x - spinLabel.size.width / 2f,
                    center.y - spinLabel.size.height / 2f + innerRingInner * 0.09f,
                ),
        )

        // Center emoji
        val centerEmoji =
            textMeasurer.measure(
                text = "\uD83C\uDFB0",
                style = TextStyle(fontSize = (innerRingInner * 0.45f / density / fontScale).sp),
                constraints = Constraints(maxWidth = (innerRingInner * 2).toInt().coerceAtLeast(1)),
            )
        drawText(
            textLayoutResult = centerEmoji,
            topLeft =
                Offset(
                    center.x - centerEmoji.size.width / 2f,
                    center.y - centerEmoji.size.height / 2f - innerRingInner * 0.03f,
                ),
        )
    }
}

private fun DrawScope.drawRing(
    gifts: List<Gift>,
    segmentAngle: Float,
    rOuter: Float,
    rInner: Float,
    litIndex: Int,
    ringName: String,
    wonSegments: Set<String>,
    center: Offset,
    textMeasurer: TextMeasurer,
) {
    if (gifts.isEmpty() || segmentAngle <= 0f) return

    val ringThickness = rOuter - rInner

    for ((index, gift) in gifts.withIndex()) {
        val isLit = litIndex == index
        val wonKey = "$ringName-$index"
        val isPrevWon = wonKey in wonSegments
        val isActive = isLit || isPrevWon

        val baseColor = SegmentColor
        val accentColor = SegmentAccentColor

        val startAngleDeg = index * segmentAngle - 90f - segmentAngle / 2f
        val startAngleRad = startAngleDeg * (PI.toFloat() / 180f)
        val endAngleRad = (startAngleDeg + segmentAngle) * (PI.toFloat() / 180f)
        val midAngleRad = (startAngleDeg + segmentAngle / 2f) * (PI.toFloat() / 180f)

        // Draw filled arc segment
        val fillColor =
            when {
                isLit -> baseColor
                isPrevWon -> baseColor.copy(alpha = 0.7f)
                else -> baseColor.copy(alpha = 0.3f)
            }

        drawArc(
            color = fillColor,
            startAngle = startAngleDeg,
            sweepAngle = segmentAngle,
            useCenter = true,
            topLeft = Offset(center.x - rOuter, center.y - rOuter),
            size = Size(rOuter * 2, rOuter * 2),
        )

        // Cut out inner portion to make a ring (draw over with background)
        drawArc(
            color = Color(0xFF0D0D1A),
            startAngle = startAngleDeg,
            sweepAngle = segmentAngle,
            useCenter = true,
            topLeft = Offset(center.x - rInner, center.y - rInner),
            size = Size(rInner * 2, rInner * 2),
        )

        // Segment border stroke
        val strokeColor =
            when {
                isLit -> Color.White
                isPrevWon -> baseColor
                else -> Color(0xFF0D0D1A)
            }
        val strokeWidth =
            when {
                isLit -> 3f
                isPrevWon -> 2f
                else -> 1.5f
            }
        drawArc(
            color = strokeColor,
            startAngle = startAngleDeg,
            sweepAngle = segmentAngle,
            useCenter = true,
            topLeft = Offset(center.x - rOuter, center.y - rOuter),
            size = Size(rOuter * 2, rOuter * 2),
            style = Stroke(strokeWidth),
        )

        // Lit glow overlay
        if (isLit) {
            drawArc(
                color = Color.White.copy(alpha = 0.18f),
                startAngle = startAngleDeg,
                sweepAngle = segmentAngle,
                useCenter = true,
                topLeft = Offset(center.x - rOuter, center.y - rOuter),
                size = Size(rOuter * 2, rOuter * 2),
            )
            drawArc(
                color = Color(0xFF0D0D1A),
                startAngle = startAngleDeg,
                sweepAngle = segmentAngle,
                useCenter = true,
                topLeft = Offset(center.x - rInner, center.y - rInner),
                size = Size(rInner * 2, rInner * 2),
            )
        }

        // Won dot marker (green dot on outer edge)
        if (isPrevWon && !isLit) {
            val dotR = rOuter - ringThickness * 0.045f
            val dotX = center.x + dotR * cos(midAngleRad)
            val dotY = center.y + dotR * sin(midAngleRad)
            val dotSize = ringThickness * 0.03f
            drawCircle(Color(0xFF00E676), radius = dotSize, center = Offset(dotX, dotY))
            drawCircle(
                Color(0xFF0D0D1A),
                radius = dotSize,
                center = Offset(dotX, dotY),
                style = Stroke(1f),
            )
        }

        // Emoji and coin text at segment midpoint
        val midR = (rOuter + rInner) / 2f
        val emojiR = midR + (rOuter - rInner) * 0.12f
        val textR = midR - (rOuter - rInner) * 0.2f

        val emojiX = center.x + emojiR * cos(midAngleRad)
        val emojiY = center.y + emojiR * sin(midAngleRad)
        val coinX = center.x + textR * cos(midAngleRad)
        val coinY = center.y + textR * sin(midAngleRad)

        val emojiPx = ringThickness * (if (isLit) 0.31f else 0.25f)
        val emojiSize = (emojiPx / density / fontScale).sp
        val emojiText = giftEmoji(gift.name)
        val emojiMeasured =
            textMeasurer.measure(
                text = emojiText,
                style = TextStyle(fontSize = emojiSize),
                maxLines = 1,
                overflow = TextOverflow.Clip,
                constraints = Constraints(maxWidth = ((rOuter - rInner) * 0.8f).toInt().coerceAtLeast(1)),
            )
        drawText(
            textLayoutResult = emojiMeasured,
            topLeft =
                Offset(
                    emojiX - emojiMeasured.size.width / 2f,
                    emojiY - emojiMeasured.size.height / 2f,
                ),
            alpha = if (isActive) 1f else 0.35f,
        )

        val coinText = "\uD83E\uDE99${formatCoins(gift.coinValue)}"
        val coinMeasured =
            textMeasurer.measure(
                text = coinText,
                style =
                    TextStyle(
                        color = if (isActive) Color.White else Color.White.copy(alpha = 0.2f),
                        fontSize = (ringThickness * 0.14f / density / fontScale).sp,
                    ),
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
                constraints = Constraints(maxWidth = ((rOuter - rInner) * 0.9f).toInt().coerceAtLeast(1)),
            )
        drawText(
            textLayoutResult = coinMeasured,
            topLeft =
                Offset(
                    coinX - coinMeasured.size.width / 2f,
                    coinY - coinMeasured.size.height / 2f,
                ),
        )
    }
}
