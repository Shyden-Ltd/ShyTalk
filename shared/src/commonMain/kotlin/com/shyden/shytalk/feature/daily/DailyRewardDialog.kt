package com.shyden.shytalk.feature.daily

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.CalendarMonth
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.shyden.shytalk.core.ui.SuperShyGold

@Composable
fun DailyRewardDialog(
    viewModel: DailyRewardViewModel,
    onDismiss: () -> Unit
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    if (!state.showDialog) return

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
            Text(
                text = if (state.reward != null) "Reward Claimed!" else "Daily Reward",
                fontWeight = FontWeight.Bold
            )
        },
        text = {
            Column(horizontalAlignment = Alignment.CenterHorizontally) {
                if (state.reward != null) {
                    val reward = state.reward!!
                    if (reward.isGiftReward) {
                        Text(
                            text = "${reward.giftQuantity}x ${reward.giftId}",
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Bold,
                            color = SuperShyGold
                        )
                    } else {
                        Text(
                            text = "+${reward.coinsAwarded} coins!",
                            style = MaterialTheme.typography.headlineMedium,
                            fontWeight = FontWeight.Bold,
                            color = SuperShyGold
                        )
                    }
                    Spacer(modifier = Modifier.height(8.dp))
                    Text("Day ${reward.newStreak} streak")
                    if (reward.isMilestone) {
                        Text(
                            "Milestone bonus!",
                            color = Color(0xFFFF6B35),
                            fontWeight = FontWeight.Bold
                        )
                    }
                } else {
                    Text("Day ${state.currentStreak + 1}")
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "Claim your daily login reward!",
                        style = MaterialTheme.typography.bodyMedium,
                        textAlign = TextAlign.Center
                    )

                    // Mini streak preview (next 7 days)
                    Spacer(modifier = Modifier.height(12.dp))
                    LazyVerticalGrid(
                        columns = GridCells.Fixed(7),
                        contentPadding = PaddingValues(0.dp),
                        horizontalArrangement = Arrangement.spacedBy(2.dp),
                        modifier = Modifier.height(50.dp)
                    ) {
                        val currentDay = state.currentStreak
                        items(7) { index ->
                            val day = currentDay + index + 1
                            val isToday = index == 0
                            Box(
                                modifier = Modifier
                                    .size(32.dp)
                                    .clip(CircleShape)
                                    .background(
                                        if (isToday) SuperShyGold
                                        else MaterialTheme.colorScheme.surfaceVariant
                                    )
                                    .then(
                                        if (isToday) Modifier.border(2.dp, SuperShyGold, CircleShape)
                                        else Modifier
                                    ),
                                contentAlignment = Alignment.Center
                            ) {
                                Text(
                                    text = "$day",
                                    fontSize = 10.sp,
                                    fontWeight = if (isToday) FontWeight.Bold else FontWeight.Normal,
                                    color = if (isToday) Color.White else MaterialTheme.colorScheme.onSurfaceVariant
                                )
                            }
                        }
                    }
                }
            }
        },
        confirmButton = {
            if (state.reward != null) {
                Button(onClick = {
                    viewModel.dismissDialog()
                    onDismiss()
                }) {
                    Text("Yay!")
                }
            } else {
                Button(
                    onClick = { viewModel.claimReward() },
                    enabled = !state.isClaiming && !state.hasClaimedToday,
                    modifier = Modifier.testTag("dailyReward_claimButton")
                ) {
                    if (state.isClaiming) {
                        CircularProgressIndicator(
                            modifier = Modifier.size(16.dp),
                            strokeWidth = 2.dp
                        )
                    } else {
                        Text("Claim")
                    }
                }
            }
        },
        dismissButton = {
            if (state.reward == null) {
                TextButton(onClick = {
                    viewModel.dismissDialog()
                    onDismiss()
                }) {
                    Text("Later")
                }
            }
        }
    )
}
