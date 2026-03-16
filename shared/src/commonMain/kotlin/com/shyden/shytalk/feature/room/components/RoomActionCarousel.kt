package com.shyden.shytalk.feature.room.components

import androidx.compose.animation.core.LinearEasing
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.tween
import androidx.compose.foundation.Canvas
import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.LocalFireDepartment
import androidx.compose.material3.Icon
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.geometry.Size
import androidx.compose.ui.graphics.Brush
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.drawscope.Stroke
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import com.shyden.shytalk.core.ui.SuperShyGold
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import kotlinx.coroutines.delay
import org.jetbrains.compose.resources.stringResource

private const val PAGE_COUNT = 2

@Composable
fun RoomActionCarousel(
    onOpenGacha: () -> Unit,
    onOpenDailyReward: () -> Unit,
    modifier: Modifier = Modifier,
) {
    val pagerState = rememberPagerState(pageCount = { PAGE_COUNT })

    // Auto-scroll
    LaunchedEffect(Unit) {
        while (true) {
            delay(4000)
            val nextPage = (pagerState.currentPage + 1) % PAGE_COUNT
            pagerState.animateScrollToPage(
                page = nextPage,
                animationSpec = tween(500, easing = LinearEasing),
            )
        }
    }

    Surface(
        modifier =
            modifier
                .size(76.dp),
        shape = RoundedCornerShape(12.dp),
        color = Color(0xFF263238).copy(alpha = 0.85f),
        shadowElevation = 4.dp,
    ) {
        Box(modifier = Modifier.padding(3.dp)) {
            HorizontalPager(
                state = pagerState,
                modifier = Modifier.fillMaxSize(),
            ) { page ->
                when (page) {
                    0 ->
                        SquareCarouselBanner(
                            icon = { MiniLuckySpinIcon(modifier = Modifier.size(28.dp)) },
                            title = stringResource(Res.string.lucky_spin),
                            gradientColors = listOf(Color(0xFFE53935), Color(0xFFFF6B35)),
                            onClick = onOpenGacha,
                        )
                    1 ->
                        SquareCarouselBanner(
                            icon = {
                                Icon(
                                    Icons.Default.LocalFireDepartment,
                                    contentDescription = null,
                                    tint = Color(0xFFFF6B35),
                                    modifier = Modifier.size(28.dp),
                                )
                            },
                            title = stringResource(Res.string.daily),
                            gradientColors = listOf(Color(0xFFFF6B35), Color(0xFFFFD700)),
                            onClick = onOpenDailyReward,
                        )
                }
            }

            // Page indicator dots (bottom center)
            Row(
                horizontalArrangement = Arrangement.Center,
                modifier =
                    Modifier
                        .align(Alignment.BottomCenter)
                        .padding(bottom = 1.dp),
            ) {
                repeat(PAGE_COUNT) { index ->
                    val isSelected = pagerState.currentPage == index
                    Box(
                        modifier =
                            Modifier
                                .padding(horizontal = 1.5.dp)
                                .size(if (isSelected) 5.dp else 3.dp)
                                .clip(CircleShape)
                                .background(
                                    if (isSelected) {
                                        Color.White
                                    } else {
                                        Color.White.copy(alpha = 0.4f)
                                    },
                                ),
                    )
                }
            }
        }
    }
}

@Composable
private fun SquareCarouselBanner(
    icon: @Composable () -> Unit,
    title: String,
    gradientColors: List<Color>,
    onClick: () -> Unit,
) {
    Box(
        modifier =
            Modifier
                .fillMaxSize()
                .clip(RoundedCornerShape(8.dp))
                .background(
                    brush = Brush.verticalGradient(gradientColors.map { it.copy(alpha = 0.3f) }),
                ).clickable { onClick() }
                .padding(4.dp),
        contentAlignment = Alignment.Center,
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            icon()
            Text(
                text = title,
                color = Color.White,
                fontWeight = FontWeight.Bold,
                fontSize = 10.sp,
                maxLines = 1,
            )
        }
    }
}

@Composable
private fun MiniLuckySpinIcon(modifier: Modifier = Modifier) {
    val transition = rememberInfiniteTransition(label = "miniSpin")
    val litSegment by transition.animateFloat(
        initialValue = 0f,
        targetValue = 7f,
        animationSpec =
            infiniteRepeatable(
                animation = tween(durationMillis = 2100, easing = LinearEasing),
            ),
        label = "miniSpinLit",
    )
    val outerSegments = 4
    val innerSegments = 3
    val currentLit = litSegment.toInt()

    Canvas(modifier = modifier) {
        val ctr = Offset(size.width / 2f, size.height / 2f)
        val r = size.width / 2f

        // Outer ring arcs (4 segments)
        val outerOuter = r - 1f
        val outerInner = r * 0.55f
        val outerAngle = 360f / outerSegments
        val outerColors = listOf(Color(0xFF9E9E9E), Color(0xFF757575), Color(0xFF9E9E9E), Color(0xFF757575))
        for (i in 0 until outerSegments) {
            val isLit = currentLit == i
            drawArc(
                color = outerColors[i].copy(alpha = if (isLit) 1f else 0.3f),
                startAngle = i * outerAngle - 90f,
                sweepAngle = outerAngle - 2f,
                useCenter = true,
                topLeft = Offset(ctr.x - outerOuter, ctr.y - outerOuter),
                size = Size(outerOuter * 2, outerOuter * 2),
            )
        }
        // Clear inner for outer ring
        drawCircle(Color(0xFF263238), radius = outerInner, center = ctr)

        // Inner ring arcs (3 segments)
        val innerOuter = outerInner - 1f
        val innerInner = r * 0.22f
        val innerAngle = 360f / innerSegments
        val innerColors = listOf(Color(0xFF9E9E9E), Color(0xFF757575), Color(0xFF9E9E9E))
        for (i in 0 until innerSegments) {
            val isLit = currentLit == (outerSegments + i)
            drawArc(
                color = innerColors[i].copy(alpha = if (isLit) 1f else 0.3f),
                startAngle = i * innerAngle - 90f,
                sweepAngle = innerAngle - 2f,
                useCenter = true,
                topLeft = Offset(ctr.x - innerOuter, ctr.y - innerOuter),
                size = Size(innerOuter * 2, innerOuter * 2),
            )
        }
        // Center dot
        drawCircle(Color(0xFF0D0D1A), radius = innerInner, center = ctr)
        drawCircle(SuperShyGold.copy(alpha = 0.4f), radius = innerInner, center = ctr, style = Stroke(1f))
    }
}
