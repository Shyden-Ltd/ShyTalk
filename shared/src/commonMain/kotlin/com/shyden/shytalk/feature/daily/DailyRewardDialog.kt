package com.shyden.shytalk.feature.daily

import androidx.compose.animation.core.Spring
import androidx.compose.animation.core.animateFloat
import androidx.compose.animation.core.animateFloatAsState
import androidx.compose.animation.core.infiniteRepeatable
import androidx.compose.animation.core.rememberInfiniteTransition
import androidx.compose.animation.core.spring
import androidx.compose.animation.core.tween
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.foundation.verticalScroll
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material.icons.filled.Check
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.graphicsLayer
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.shyden.shytalk.core.ui.SuperShyGold
import com.shyden.shytalk.core.util.currentTimeMillis
import kotlinx.datetime.DayOfWeek
import kotlinx.datetime.Instant
import kotlinx.datetime.LocalDate
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

@Composable
fun DailyRewardDialog(
    viewModel: DailyRewardViewModel,
    onDismiss: () -> Unit
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    if (!state.showDialog) return

    val now = Instant.fromEpochMilliseconds(currentTimeMillis()).toLocalDateTime(TimeZone.currentSystemDefault())
    val currentYear = now.year
    val currentMonth = now.monthNumber
    val todayDay = now.dayOfMonth

    // Calculate month details
    val firstOfMonth = LocalDate(currentYear, currentMonth, 1)
    val daysInMonth = when (currentMonth) {
        2 -> if (currentYear % 4 == 0 && (currentYear % 100 != 0 || currentYear % 400 == 0)) 29 else 28
        4, 6, 9, 11 -> 30
        else -> 31
    }
    // Monday = 0, Sunday = 6 for grid alignment
    val startDayOfWeek = (firstOfMonth.dayOfWeek.ordinal) // Monday=0 ... Sunday=6

    val monthName = now.month.name.lowercase().replaceFirstChar { it.uppercase() }

    AlertDialog(
        onDismissRequest = {
            viewModel.dismissDialog()
            onDismiss()
        },
        modifier = Modifier.testTag("dailyReward_dialog"),
        icon = {
            Icon(
                imageVector = Icons.Filled.CalendarMonth,
                contentDescription = null,
                tint = SuperShyGold,
                modifier = Modifier.size(32.dp)
            )
        },
        title = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                Text(
                    text = "$monthName $currentYear",
                    fontWeight = FontWeight.Bold
                )
                if (state.currentStreak > 0) {
                    Text(
                        text = "${state.currentStreak}-day streak",
                        style = MaterialTheme.typography.bodySmall,
                        color = SuperShyGold,
                        fontWeight = FontWeight.Bold
                    )
                }
            }
        },
        text = {
            Column(
                modifier = Modifier.verticalScroll(rememberScrollState()),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                // Claimed reward display
                if (state.reward != null) {
                    val reward = state.reward!!
                    if (reward.isGiftReward) {
                        Text(
                            text = "${reward.giftQuantity}x ${reward.giftId}",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = SuperShyGold
                        )
                    } else {
                        Text(
                            text = "+${reward.coinsAwarded} coins!",
                            style = MaterialTheme.typography.titleMedium,
                            fontWeight = FontWeight.Bold,
                            color = SuperShyGold
                        )
                    }
                    if (reward.isMilestone) {
                        Text(
                            "Milestone bonus!",
                            color = Color(0xFFFF6B35),
                            fontWeight = FontWeight.Bold,
                            fontSize = 12.sp
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                }

                // Day-of-week headers
                Row(
                    modifier = Modifier.fillMaxWidth(),
                    horizontalArrangement = Arrangement.SpaceEvenly
                ) {
                    listOf("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun").forEach { day ->
                        Text(
                            text = day,
                            fontSize = 10.sp,
                            fontWeight = FontWeight.Bold,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                            modifier = Modifier.weight(1f)
                        )
                    }
                }

                Spacer(modifier = Modifier.height(4.dp))

                // Calendar grid
                var dayCounter = 1
                val totalCells = startDayOfWeek + daysInMonth
                val rows = (totalCells + 6) / 7

                for (row in 0 until rows) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.SpaceEvenly
                    ) {
                        for (col in 0 until 7) {
                            val cellIndex = row * 7 + col
                            if (cellIndex < startDayOfWeek || dayCounter > daysInMonth) {
                                // Empty cell
                                Box(modifier = Modifier.weight(1f).height(40.dp))
                            } else {
                                val day = dayCounter
                                val isClaimed = day in state.claimedDaysThisMonth
                                val isToday = day == todayDay
                                val isPast = day < todayDay
                                val isFuture = day > todayDay
                                val isMilestone = state.milestoneRewards.containsKey(day)

                                // Determine reward amount for this day
                                val rewardAmount = state.milestoneRewards[day]?.amount
                                    ?: state.dailyBase

                                Box(
                                    modifier = Modifier
                                        .weight(1f)
                                        .height(40.dp),
                                    contentAlignment = Alignment.Center
                                ) {
                                    DayCell(
                                        day = day,
                                        rewardAmount = rewardAmount,
                                        isClaimed = isClaimed,
                                        isToday = isToday,
                                        isPast = isPast,
                                        isFuture = isFuture,
                                        isMilestone = isMilestone
                                    )
                                }
                                dayCounter++
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (state.hasClaimedToday) {
                Button(onClick = {
                    viewModel.dismissDialog()
                    onDismiss()
                }) {
                    Text("Close")
                }
            } else {
                Button(
                    onClick = { viewModel.claimReward() },
                    enabled = !state.isClaiming,
                    modifier = Modifier.testTag("dailyReward_claimButton")
                ) {
                    if (state.isClaiming) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp
                        )
                    } else {
                        Text("Claim Today's Reward")
                    }
                }
            }
        },
        dismissButton = {
            TextButton(onClick = {
                viewModel.dismissDialog()
                onDismiss()
            }) {
                Text(if (state.hasClaimedToday) "" else "Later")
            }
        }
    )
}

@Composable
private fun DayCell(
    day: Int,
    rewardAmount: Int,
    isClaimed: Boolean,
    isToday: Boolean,
    isPast: Boolean,
    isFuture: Boolean,
    isMilestone: Boolean
) {
    val bgColor = when {
        isClaimed && isToday -> SuperShyGold
        isClaimed -> Color(0xFF4CAF50)
        isToday -> SuperShyGold.copy(alpha = 0.15f)
        isPast -> MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.4f)
        else -> Color.Transparent // future
    }

    val borderColor = when {
        isToday && !isClaimed -> SuperShyGold
        isMilestone -> Color(0xFFFF6B35)
        else -> Color.Transparent
    }

    val textColor = when {
        isClaimed -> Color.White
        isToday -> MaterialTheme.colorScheme.onSurface
        isPast -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.5f)
        else -> MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
    }

    // Gold pulse animation for today unclaimed
    val pulseAlpha = if (isToday && !isClaimed) {
        val transition = rememberInfiniteTransition(label = "dayPulse")
        val alpha by transition.animateFloat(
            initialValue = 0.15f,
            targetValue = 0.35f,
            animationSpec = infiniteRepeatable(animation = tween(800)),
            label = "dayPulseAlpha"
        )
        alpha
    } else 0f

    Box(
        modifier = Modifier
            .size(34.dp)
            .clip(RoundedCornerShape(6.dp))
            .then(
                if (isToday && !isClaimed) Modifier.background(SuperShyGold.copy(alpha = pulseAlpha))
                else Modifier.background(bgColor)
            )
            .then(
                if (borderColor != Color.Transparent) Modifier.border(1.5.dp, borderColor, RoundedCornerShape(6.dp))
                else Modifier
            ),
        contentAlignment = Alignment.Center
    ) {
        Column(horizontalAlignment = Alignment.CenterHorizontally) {
            if (isClaimed) {
                Icon(
                    Icons.Filled.Check,
                    contentDescription = "Claimed",
                    tint = Color.White,
                    modifier = Modifier.size(12.dp)
                )
            }
            Text(
                text = "$day",
                fontSize = if (isClaimed) 8.sp else 10.sp,
                fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal,
                color = textColor
            )
            if (!isClaimed && rewardAmount > 0) {
                Text(
                    text = "\uD83E\uDE99$rewardAmount",
                    fontSize = 6.sp,
                    color = if (isMilestone) Color(0xFFFF6B35) else textColor.copy(alpha = 0.7f),
                    fontWeight = if (isMilestone) FontWeight.Bold else FontWeight.Normal
                )
            }
        }
        // Milestone star badge
        if (isMilestone) {
            Icon(
                Icons.Filled.Star,
                contentDescription = "Milestone",
                tint = Color(0xFFFF6B35),
                modifier = Modifier
                    .size(10.dp)
                    .align(Alignment.TopEnd)
            )
        }
    }
}

@Composable
fun DailyRewardCelebrationDialog(
    viewModel: DailyRewardViewModel,
    onDismiss: () -> Unit
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val reward = state.reward ?: return
    if (!state.showCelebration) return

    // Bounce-in animation
    var animateIn by remember { mutableStateOf(false) }
    val scale by animateFloatAsState(
        targetValue = if (animateIn) 1f else 0f,
        animationSpec = spring(dampingRatio = Spring.DampingRatioMediumBouncy, stiffness = Spring.StiffnessLow),
        label = "celebrationScale"
    )
    LaunchedEffect(Unit) { animateIn = true }

    AlertDialog(
        onDismissRequest = {
            viewModel.dismissCelebration()
            onDismiss()
        },
        icon = {
            Text(
                text = "\uD83C\uDF89",
                fontSize = 40.sp,
                modifier = Modifier.graphicsLayer(scaleX = scale, scaleY = scale)
            )
        },
        title = {
            Text(
                text = "Reward Claimed!",
                fontWeight = FontWeight.Bold,
                textAlign = TextAlign.Center,
                modifier = Modifier.fillMaxWidth()
            )
        },
        text = {
            Column(
                modifier = Modifier.fillMaxWidth(),
                horizontalAlignment = Alignment.CenterHorizontally
            ) {
                if (reward.isGiftReward) {
                    Text(
                        text = "${reward.giftQuantity}x ${reward.giftId}",
                        style = MaterialTheme.typography.headlineSmall,
                        fontWeight = FontWeight.Bold,
                        color = SuperShyGold,
                        textAlign = TextAlign.Center
                    )
                } else {
                    Text(
                        text = "+${reward.coinsAwarded}",
                        style = MaterialTheme.typography.headlineMedium,
                        fontWeight = FontWeight.Bold,
                        color = SuperShyGold
                    )
                    Text(
                        text = "coins",
                        style = MaterialTheme.typography.bodyLarge,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                if (reward.isMilestone) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        text = "Milestone bonus!",
                        color = Color(0xFFFF6B35),
                        fontWeight = FontWeight.Bold,
                        fontSize = 14.sp
                    )
                }

                Spacer(modifier = Modifier.height(12.dp))

                Text(
                    text = "${state.currentStreak}-day streak",
                    style = MaterialTheme.typography.bodyMedium,
                    color = SuperShyGold,
                    fontWeight = FontWeight.SemiBold
                )
            }
        },
        confirmButton = {
            Button(onClick = {
                viewModel.dismissCelebration()
                onDismiss()
            }) {
                Text("Awesome!")
            }
        }
    )
}
