package com.shyden.shytalk.feature.room.components

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.Button
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.shyden.shytalk.core.model.BackpackItem
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.GiftBracket
import com.shyden.shytalk.feature.gifting.GiftingUiState
import com.shyden.shytalk.feature.gifting.GiftingViewModel

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BackpackSheet(
    viewModel: GiftingViewModel,
    recipientId: String = "",
    recipientName: String = "",
    currentUserId: String = "",
    onDismiss: () -> Unit
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()
    val isSelfView = recipientId.isBlank() || recipientId == currentUserId

    ModalBottomSheet(onDismissRequest = onDismiss) {
        Column(
            modifier = Modifier
                .fillMaxWidth()
                .padding(16.dp),
            horizontalAlignment = Alignment.CenterHorizontally
        ) {
            Text(
                if (isSelfView) "Your Backpack" else "Send a gift to $recipientName",
                style = MaterialTheme.typography.titleMedium,
                fontWeight = FontWeight.Bold
            )
            Spacer(modifier = Modifier.height(12.dp))

            if (state.backpackItems.isEmpty()) {
                Text(
                    "Your backpack is empty.\nSpin the wheel to get gifts!",
                    style = MaterialTheme.typography.bodyMedium,
                    color = MaterialTheme.colorScheme.onSurfaceVariant,
                    textAlign = TextAlign.Center
                )
            } else {
                val totalValue = remember(state.backpackItems, state.giftCatalog) {
                    state.backpackItems.sumOf { item ->
                        val coinValue = state.giftCatalog.find { it.id == item.giftId }?.coinValue ?: 0
                        coinValue * item.quantity
                    }
                }

                Row(
                    verticalAlignment = Alignment.CenterVertically,
                    horizontalArrangement = Arrangement.Center,
                    modifier = Modifier.fillMaxWidth()
                ) {
                    Text(
                        "\uD83E\uDE99",
                        fontSize = 14.sp
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = "$totalValue",
                        style = MaterialTheme.typography.titleSmall,
                        fontWeight = FontWeight.ExtraBold,
                        color = Color(0xFFFFD700)
                    )
                    Spacer(modifier = Modifier.width(4.dp))
                    Text(
                        text = "total value",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )
                }

                Spacer(modifier = Modifier.height(8.dp))

                val sortedItems = remember(state.backpackItems, state.giftCatalog) {
                    state.backpackItems.sortedWith(
                        compareByDescending<BackpackItem> { item ->
                            state.giftCatalog.find { it.id == item.giftId }?.coinValue ?: 0
                        }.thenBy { item ->
                            state.giftCatalog.find { it.id == item.giftId }?.name ?: ""
                        }
                    )
                }
                LazyVerticalGrid(
                    columns = GridCells.Fixed(4),
                    contentPadding = PaddingValues(4.dp),
                    horizontalArrangement = Arrangement.spacedBy(8.dp),
                    verticalArrangement = Arrangement.spacedBy(8.dp),
                    modifier = Modifier.height(250.dp)
                ) {
                    items(sortedItems) { item ->
                        val gift = state.giftCatalog.find { it.id == item.giftId }
                        if (gift != null) {
                            BackpackGiftItem(
                                gift = gift,
                                quantity = item.quantity,
                                isSelected = !isSelfView && state.selectedGiftId == item.giftId,
                                onClick = {
                                    if (!isSelfView) viewModel.selectGift(item.giftId)
                                }
                            )
                        }
                    }
                }

                if (!isSelfView) {
                    Spacer(modifier = Modifier.height(12.dp))

                    Button(
                        onClick = {
                            state.selectedGiftId?.let { giftId ->
                                viewModel.sendGift(recipientId, giftId)
                            }
                        },
                        enabled = state.selectedGiftId != null && !state.isSending
                    ) {
                        Text(if (state.isSending) "Sending..." else "Send Gift")
                    }
                }
            }

            Spacer(modifier = Modifier.height(16.dp))
        }
    }
}

@Composable
private fun BackpackGiftItem(
    gift: Gift,
    quantity: Int,
    isSelected: Boolean,
    onClick: () -> Unit
) {
    val bracketColor = when (gift.bracket) {
        GiftBracket.COMMON -> Color.Gray
        GiftBracket.UNCOMMON -> Color(0xFF4CAF50)
        GiftBracket.RARE -> Color(0xFF2196F3)
        GiftBracket.EPIC -> Color(0xFF9C27B0)
        GiftBracket.LEGENDARY -> Color(0xFFFFD700)
    }

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .clip(RoundedCornerShape(8.dp))
            .border(
                width = if (isSelected) 3.dp else 1.dp,
                color = if (isSelected) MaterialTheme.colorScheme.primary else bracketColor.copy(alpha = 0.5f),
                shape = RoundedCornerShape(8.dp)
            )
            .background(bracketColor.copy(alpha = 0.1f))
            .clickable { onClick() }
            .padding(6.dp)
    ) {
        Box(
            modifier = Modifier
                .size(36.dp)
                .clip(CircleShape)
                .background(bracketColor.copy(alpha = 0.2f)),
            contentAlignment = Alignment.Center
        ) {
            Text(gift.name.take(2), fontWeight = FontWeight.Bold, color = bracketColor, fontSize = 12.sp)
        }
        Text(
            gift.name,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            fontSize = 9.sp,
            overflow = TextOverflow.Ellipsis
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text(
                "\uD83E\uDE99",
                fontSize = 8.sp
            )
            Spacer(modifier = Modifier.width(1.dp))
            Text(
                "${gift.coinValue}",
                style = MaterialTheme.typography.labelSmall,
                fontSize = 8.sp,
                color = Color(0xFFFFD700),
                maxLines = 1
            )
        }
        Text("x$quantity", style = MaterialTheme.typography.labelSmall, fontWeight = FontWeight.Bold, color = bracketColor)
    }
}
