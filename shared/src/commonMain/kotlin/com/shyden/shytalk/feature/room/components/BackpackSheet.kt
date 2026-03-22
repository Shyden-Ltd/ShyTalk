package com.shyden.shytalk.feature.room.components

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.aspectRatio
import androidx.compose.foundation.layout.fillMaxHeight
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.layout.widthIn
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.pager.HorizontalPager
import androidx.compose.foundation.pager.rememberPagerState
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Button
import androidx.compose.material3.ButtonDefaults
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.LinearProgressIndicator
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.PrimaryTabRow
import androidx.compose.material3.Tab
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.LaunchedEffect
import androidx.compose.runtime.getValue
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.platform.LocalDensity
import androidx.compose.ui.platform.LocalWindowInfo
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import androidx.compose.ui.window.PopupProperties
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.BackpackItem
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.feature.gifting.GiftingViewModel
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource
import kotlin.math.ceil

private val CyanAccent = Color(0xFF00BCD4)

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun BackpackSheet(
    viewModel: GiftingViewModel,
    seatedUsers: List<User> = emptyList(),
    additionalUsers: List<User> = emptyList(),
    currentUserId: String = "",
    onDismiss: () -> Unit,
    onNavigateToWallet: () -> Unit = {},
    onLongPressGift: ((Gift) -> Unit)? = null,
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    ModalBottomSheet(
        onDismissRequest = onDismiss,
        sheetMaxWidth = Dp.Unspecified,
    ) {
        val density = LocalDensity.current
        val screenHeightDp =
            with(density) {
                LocalWindowInfo.current.containerSize.height
                    .toDp()
            }
        // Use a taller fraction on short screens so grid items stay full-size
        val sheetFraction = if (screenHeightDp < 700.dp) 0.55f else 0.42f
        Column(
            modifier =
                Modifier
                    .fillMaxWidth()
                    .fillMaxHeight(sheetFraction)
                    .padding(horizontal = 8.dp),
        ) {
            // ── Recipient Row ──
            val allRecipientUsers =
                remember(seatedUsers, additionalUsers) {
                    val seatedIds = seatedUsers.map { it.uid }.toSet()
                    seatedUsers + additionalUsers.filter { it.uid !in seatedIds }
                }
            RecipientRow(
                seatedUsers = allRecipientUsers,
                seatedUserIds = seatedUsers.map { it.uid }.toSet(),
                currentUserId = currentUserId,
                selectedRecipientIds = state.selectedRecipientIds,
                isAllSelected = state.isAllSelected,
                onToggleRecipient = { viewModel.toggleRecipient(it) },
                onSelectAll = {
                    val allIds = allRecipientUsers.map { it.uid }.toSet()
                    viewModel.selectAllRecipients(allIds)
                },
                onDeselectAll = { viewModel.deselectAllRecipients() },
            )

            Spacer(modifier = Modifier.height(2.dp))

            // ── Tab Row ──
            val backpackValue =
                remember(state.backpackItems, state.giftCatalog) {
                    state.backpackItems.sumOf { bp ->
                        val gift = state.giftCatalog.find { it.id == bp.giftId }
                        (gift?.coinValue?.toLong() ?: 0L) * bp.quantity
                    }
                }
            @OptIn(androidx.compose.material3.ExperimentalMaterial3Api::class)
            PrimaryTabRow(
                selectedTabIndex = state.activeTab,
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .clip(RoundedCornerShape(8.dp)),
            ) {
                Tab(
                    selected = state.activeTab == 0,
                    onClick = { viewModel.setActiveTab(0) },
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(Res.string.gifts))
                            Spacer(modifier = Modifier.width(6.dp))
                            Text("\uD83E\uDE99", fontSize = 10.sp)
                            Text(
                                formatLargeNumber(state.coinBalance),
                                fontSize = 10.sp,
                                color = Color(0xFFFFD700),
                                fontWeight = FontWeight.Bold,
                            )
                        }
                    },
                )
                Tab(
                    selected = state.activeTab == 1,
                    onClick = { viewModel.setActiveTab(1) },
                    text = {
                        Row(verticalAlignment = Alignment.CenterVertically) {
                            Text(stringResource(Res.string.backpack))
                            if (backpackValue > 0) {
                                Spacer(modifier = Modifier.width(6.dp))
                                Text("\uD83E\uDE99", fontSize = 10.sp)
                                Text(
                                    formatLargeNumber(backpackValue),
                                    fontSize = 10.sp,
                                    color = Color(0xFFFFD700),
                                    fontWeight = FontWeight.Bold,
                                )
                            }
                        }
                    },
                )
            }

            Spacer(modifier = Modifier.height(2.dp))

            // ── Paged Grid ──
            val items =
                remember(state.giftCatalog, state.backpackItems, state.activeTab) {
                    if (state.activeTab == 0) {
                        state.giftCatalog.filter { it.showInStore }.sortedByDescending { it.coinValue }.map { gift ->
                            GridItem(gift = gift)
                        }
                    } else {
                        state.backpackItems
                            .mapNotNull { item ->
                                state.giftCatalog.find { it.id == item.giftId }?.let { gift ->
                                    GridItem(gift = gift, ownedQuantity = item.quantity, backpackItem = item)
                                }
                            }.sortedByDescending { it.gift.coinValue }
                    }
                }

            Box(modifier = Modifier.weight(1f)) {
                if (items.isEmpty() && state.activeTab == 1) {
                    Box(
                        modifier = Modifier.fillMaxWidth().height(160.dp),
                        contentAlignment = Alignment.Center,
                    ) {
                        Text(
                            stringResource(Res.string.backpack_empty),
                            style = MaterialTheme.typography.bodyMedium,
                            color = MaterialTheme.colorScheme.onSurfaceVariant,
                            textAlign = TextAlign.Center,
                        )
                    }
                } else {
                    PagedGiftGrid(
                        items = items,
                        selectedGiftId = state.selectedGiftId,
                        isBackpackTab = state.activeTab == 1,
                        onSelectGift = { viewModel.selectGift(it) },
                        onLongPressGift = onLongPressGift,
                    )
                }
            }

            // ── Bottom Bar ──
            val isTrialSelected = state.activeTab == 1 && state.selectedGiftId == Constants.SUPER_SHY_TRIAL_ID
            if (isTrialSelected) {
                // Trial item: show Use button only, no quantity/send-all
                BottomBar(
                    state = state,
                    giftCatalog = state.giftCatalog,
                    isBackpackTab = true,
                    onNavigateToWallet = onNavigateToWallet,
                    onQuantityClick = {},
                    onSendClick = { viewModel.activateTrial() },
                    onSendAllClick = null,
                    sendLabel = stringResource(Res.string.use_button),
                    isSelfUse = true,
                )
            } else {
                BottomBar(
                    state = state,
                    giftCatalog = state.giftCatalog,
                    isBackpackTab = state.activeTab == 1,
                    onNavigateToWallet = onNavigateToWallet,
                    onQuantityClick = { viewModel.toggleQuantityPicker() },
                    onSendClick = { viewModel.requestSend() },
                    onSendAllClick =
                        if (state.activeTab == 1 && state.selectedRecipientIds.size == 1 && state.backpackItems.isNotEmpty()) {
                            { viewModel.requestSendAll(state.selectedRecipientIds.first()) }
                        } else {
                            null
                        },
                )
            }

            // ── Quantity Picker Popup ──
            if (state.showQuantityPicker) {
                QuantityPickerPopup(
                    selectedGiftId = state.selectedGiftId,
                    backpackItems = state.backpackItems,
                    coinBalance = state.coinBalance,
                    giftCatalog = state.giftCatalog,
                    isBackpackTab = state.activeTab == 1,
                    selectedQuantity = state.selectedQuantity,
                    recipientCount = state.selectedRecipientIds.size.coerceAtLeast(1),
                    onSelectQuantity = {
                        viewModel.setQuantity(it)
                        viewModel.toggleQuantityPicker()
                    },
                    onDismiss = { viewModel.toggleQuantityPicker() },
                )
            }

            // ── Confirmation Dialog ──
            if (state.showConfirmDialog) {
                ConfirmSendDialog(
                    state = state,
                    giftCatalog = state.giftCatalog,
                    isBackpackTab = state.activeTab == 1,
                    onConfirm = { viewModel.confirmSend() },
                    onDismiss = { viewModel.dismissConfirmDialog() },
                )
            }

            // ── Send All Confirmation Dialog ──
            if (state.showSendAllConfirm) {
                val recipientId = state.sendAllRecipientId ?: ""
                val recipientUser = (seatedUsers + additionalUsers).find { it.uid == recipientId }
                val recipientName = recipientUser?.displayName ?: stringResource(Res.string.this_user)
                val totalItems = state.backpackItems.sumOf { it.quantity }
                val uniqueGifts = state.backpackItems.size
                val totalValue =
                    state.backpackItems.sumOf { bp ->
                        val gift = state.giftCatalog.find { it.id == bp.giftId }
                        (gift?.coinValue?.toLong() ?: 0L) * bp.quantity
                    }

                SendAllConfirmDialog(
                    recipientName = recipientName,
                    totalItems = totalItems,
                    uniqueGifts = uniqueGifts,
                    totalValue = totalValue,
                    onConfirm = { viewModel.confirmSendAll() },
                    onDismiss = { viewModel.dismissSendAllConfirm() },
                )
            }

            // ── Navigate to Wallet ──
            LaunchedEffect(state.navigateToWallet) {
                if (state.navigateToWallet) {
                    onNavigateToWallet()
                    viewModel.clearNavigateToWallet()
                }
            }

            Spacer(modifier = Modifier.height(2.dp))
        }
    }
}

// ── Data class for grid items ──

private data class GridItem(
    val gift: Gift,
    val ownedQuantity: Int = 0,
    val backpackItem: BackpackItem? = null,
)

// ── Recipient Row ──

@Composable
private fun RecipientRow(
    seatedUsers: List<User>,
    seatedUserIds: Set<String>,
    currentUserId: String,
    selectedRecipientIds: Set<String>,
    isAllSelected: Boolean,
    onToggleRecipient: (String) -> Unit,
    onSelectAll: () -> Unit,
    onDeselectAll: () -> Unit,
) {
    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
    ) {
        Text(
            stringResource(Res.string.to_label),
            style = MaterialTheme.typography.labelLarge,
            fontWeight = FontWeight.Bold,
            modifier = Modifier.padding(end = 8.dp),
        )

        val otherUsers = seatedUsers.filter { it.uid != currentUserId }

        LazyRow(
            modifier = Modifier.weight(1f),
            horizontalArrangement = Arrangement.spacedBy(6.dp),
            contentPadding = PaddingValues(end = 8.dp),
        ) {
            items(otherUsers, key = { it.uid }) { user ->
                val isSelected = user.uid in selectedRecipientIds
                // Only show seat badge for users actually in seats
                val seatIndex =
                    if (user.uid in seatedUserIds) {
                        seatedUsers.indexOf(user)
                    } else {
                        null
                    }
                RecipientAvatar(
                    user = user,
                    isSelected = isSelected,
                    seatNumber = seatIndex,
                    onClick = { onToggleRecipient(user.uid) },
                )
            }
        }

        // ALL button
        if (otherUsers.isNotEmpty()) {
            TextButton(
                onClick = { if (isAllSelected) onDeselectAll() else onSelectAll() },
                contentPadding = PaddingValues(horizontal = 8.dp, vertical = 4.dp),
                colors =
                    ButtonDefaults.textButtonColors(
                        containerColor = if (isAllSelected) CyanAccent.copy(alpha = 0.2f) else Color.Transparent,
                        contentColor = if (isAllSelected) CyanAccent else MaterialTheme.colorScheme.onSurfaceVariant,
                    ),
                modifier = Modifier.height(32.dp),
            ) {
                Text(stringResource(Res.string.all_caps), fontSize = 12.sp, fontWeight = FontWeight.Bold)
            }
        }
    }
}

@Composable
private fun RecipientAvatar(
    user: User,
    isSelected: Boolean,
    seatNumber: Int?,
    onClick: () -> Unit,
) {
    Box(
        modifier =
            Modifier
                .size(44.dp)
                .clickable(onClick = onClick),
    ) {
        val photoUrl = user.photoUrl
        if (photoUrl != null) {
            AsyncImage(
                model = photoUrl,
                contentDescription = user.displayName,
                modifier =
                    Modifier
                        .size(40.dp)
                        .align(Alignment.TopCenter)
                        .clip(CircleShape)
                        .border(
                            width = 2.dp,
                            color = if (isSelected) CyanAccent else MaterialTheme.colorScheme.outlineVariant,
                            shape = CircleShape,
                        ),
                contentScale = ContentScale.Crop,
            )
        } else {
            Box(
                modifier =
                    Modifier
                        .size(40.dp)
                        .align(Alignment.TopCenter)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.secondaryContainer)
                        .border(
                            width = 2.dp,
                            color = if (isSelected) CyanAccent else MaterialTheme.colorScheme.outlineVariant,
                            shape = CircleShape,
                        ),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    user.displayName.take(1).uppercase(),
                    fontWeight = FontWeight.Bold,
                    fontSize = 14.sp,
                    color = MaterialTheme.colorScheme.onSecondaryContainer,
                )
            }
        }

        // Seat number badge
        if (seatNumber != null) {
            Box(
                modifier =
                    Modifier
                        .align(Alignment.BottomCenter)
                        .size(16.dp)
                        .clip(CircleShape)
                        .background(MaterialTheme.colorScheme.primary),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "${seatNumber + 1}",
                    fontSize = 9.sp,
                    fontWeight = FontWeight.Bold,
                    color = MaterialTheme.colorScheme.onPrimary,
                )
            }
        }
    }
}

// ── Paged Gift Grid ──

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun PagedGiftGrid(
    items: List<GridItem>,
    selectedGiftId: String?,
    isBackpackTab: Boolean,
    onSelectGift: (String?) -> Unit,
    onLongPressGift: ((Gift) -> Unit)?,
) {
    val pageSize = 8 // 4 cols × 2 rows
    val pageCount = if (items.isEmpty()) 1 else ceil(items.size.toDouble() / pageSize).toInt()
    val pagerState = rememberPagerState(pageCount = { pageCount })

    Column {
        HorizontalPager(
            state = pagerState,
            modifier = Modifier.fillMaxWidth().weight(1f),
        ) { page ->
            val pageItems = items.drop(page * pageSize).take(pageSize)
            Column(
                modifier = Modifier.fillMaxWidth().padding(horizontal = 2.dp),
                verticalArrangement = Arrangement.spacedBy(2.dp),
            ) {
                for (row in 0 until 2) {
                    Row(
                        modifier = Modifier.fillMaxWidth(),
                        horizontalArrangement = Arrangement.spacedBy(2.dp),
                    ) {
                        for (col in 0 until 4) {
                            val index = row * 4 + col
                            if (index < pageItems.size) {
                                val item = pageItems[index]
                                Box(modifier = Modifier.weight(1f).aspectRatio(1f)) {
                                    if (isBackpackTab) {
                                        BackpackGiftCell(
                                            item = item,
                                            isSelected = selectedGiftId == item.gift.id,
                                            onClick = {
                                                onSelectGift(
                                                    if (selectedGiftId == item.gift.id) null else item.gift.id,
                                                )
                                            },
                                            onLongClick = { onLongPressGift?.invoke(item.gift) },
                                        )
                                    } else {
                                        ShopGiftCell(
                                            item = item,
                                            isSelected = selectedGiftId == item.gift.id,
                                            onClick = {
                                                onSelectGift(
                                                    if (selectedGiftId == item.gift.id) null else item.gift.id,
                                                )
                                            },
                                            onLongClick = { onLongPressGift?.invoke(item.gift) },
                                        )
                                    }
                                }
                            } else {
                                Spacer(modifier = Modifier.weight(1f).aspectRatio(1f))
                            }
                        }
                    }
                }
            }
        }

        // Page indicator dots
        if (pageCount > 1) {
            Row(
                modifier = Modifier.fillMaxWidth().padding(top = 4.dp),
                horizontalArrangement = Arrangement.Center,
            ) {
                repeat(pageCount) { i ->
                    Box(
                        modifier =
                            Modifier
                                .padding(horizontal = 3.dp)
                                .size(if (i == pagerState.currentPage) 8.dp else 6.dp)
                                .clip(CircleShape)
                                .background(
                                    if (i == pagerState.currentPage) {
                                        CyanAccent
                                    } else {
                                        MaterialTheme.colorScheme.outlineVariant
                                    },
                                ),
                    )
                }
            }
        }
    }
}

// ── Gift Cells ──

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun ShopGiftCell(
    item: GridItem,
    isSelected: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) {
    val borderColor = if (isSelected) CyanAccent else MaterialTheme.colorScheme.outlineVariant
    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
        modifier =
            Modifier
                .aspectRatio(1f)
                .clip(RoundedCornerShape(8.dp))
                .border(
                    width = if (isSelected) 3.dp else 1.dp,
                    color = borderColor,
                    shape = RoundedCornerShape(8.dp),
                ).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f))
                .combinedClickable(onClick = onClick, onLongClick = onLongClick)
                .padding(2.dp),
    ) {
        GiftIcon(gift = item.gift, size = 36)
        Text(
            item.gift.name,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            fontSize = 9.sp,
            overflow = TextOverflow.Ellipsis,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("\uD83E\uDE99", fontSize = 8.sp)
            Spacer(modifier = Modifier.width(1.dp))
            Text(
                "${item.gift.coinValue}",
                style = MaterialTheme.typography.labelSmall,
                fontSize = 8.sp,
                color = Color(0xFFFFD700),
                maxLines = 1,
            )
        }
    }
}

@OptIn(ExperimentalFoundationApi::class)
@Composable
private fun BackpackGiftCell(
    item: GridItem,
    isSelected: Boolean,
    onClick: () -> Unit,
    onLongClick: () -> Unit,
) {
    val borderColor = if (isSelected) CyanAccent else MaterialTheme.colorScheme.outlineVariant
    val bp = item.backpackItem

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center,
        modifier =
            Modifier
                .aspectRatio(1f)
                .clip(RoundedCornerShape(8.dp))
                .border(
                    width = if (isSelected) 3.dp else 1.dp,
                    color = borderColor,
                    shape = RoundedCornerShape(8.dp),
                ).background(MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f))
                .combinedClickable(onClick = onClick, onLongClick = onLongClick)
                .padding(2.dp),
    ) {
        // Expiry progress bar
        if (bp != null && bp.isExpiring) {
            val fraction = (bp.remainingMs.toFloat() / (bp.expiresAt - bp.lastAcquired).coerceAtLeast(1).toFloat()).coerceIn(0f, 1f)
            LinearProgressIndicator(
                progress = { fraction },
                modifier = Modifier.fillMaxWidth().height(3.dp).clip(RoundedCornerShape(2.dp)),
                color = Color(0xFF4CAF50),
                trackColor = MaterialTheme.colorScheme.surfaceVariant,
            )
        }

        Box {
            GiftIcon(gift = item.gift, size = 36)

            // Red quantity badge
            Box(
                modifier =
                    Modifier
                        .align(Alignment.TopEnd)
                        .size(20.dp)
                        .clip(CircleShape)
                        .background(Color.Red),
                contentAlignment = Alignment.Center,
            ) {
                Text(
                    "${item.ownedQuantity}",
                    fontSize = 8.sp,
                    fontWeight = FontWeight.ExtraBold,
                    color = Color.White,
                )
            }

            // Countdown overlay
            if (bp != null && bp.isExpiring) {
                val remaining = bp.remainingMs
                val label = formatCountdown(remaining)
                Text(
                    label,
                    fontSize = 7.sp,
                    fontWeight = FontWeight.Bold,
                    color = Color.White,
                    modifier =
                        Modifier
                            .align(Alignment.BottomCenter)
                            .background(Color.Black.copy(alpha = 0.6f), RoundedCornerShape(2.dp))
                            .padding(horizontal = 2.dp),
                )
            }
        }
        Text(
            item.gift.name,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            fontSize = 9.sp,
            overflow = TextOverflow.Ellipsis,
        )
        Row(verticalAlignment = Alignment.CenterVertically) {
            Text("\uD83E\uDE99", fontSize = 8.sp)
            Spacer(modifier = Modifier.width(1.dp))
            Text(
                "${item.gift.coinValue}",
                style = MaterialTheme.typography.labelSmall,
                fontSize = 8.sp,
                color = Color(0xFFFFD700),
                maxLines = 1,
            )
        }
    }
}

private fun formatCountdown(ms: Long): String {
    val totalMinutes = ms / 60_000
    val hours = totalMinutes / 60
    val days = hours / 24
    return when {
        days > 0 -> "${days}d ${hours % 24}h"
        hours > 0 -> "${hours}h ${totalMinutes % 60}m"
        else -> "${totalMinutes}m"
    }
}

// ── Bottom Bar ──

@Composable
private fun BottomBar(
    state: com.shyden.shytalk.feature.gifting.GiftingUiState,
    giftCatalog: List<Gift>,
    isBackpackTab: Boolean,
    onNavigateToWallet: () -> Unit,
    onQuantityClick: () -> Unit,
    onSendClick: () -> Unit,
    onSendAllClick: (() -> Unit)? = null,
    sendLabel: String? = null,
    isSelfUse: Boolean = false,
) {
    val selectedGift = state.selectedGiftId?.let { id -> giftCatalog.find { it.id == id } }
    val hasRecipients = state.selectedRecipientIds.isNotEmpty()
    val canSend =
        selectedGift != null &&
            !state.isSending &&
            if (isSelfUse) !hasRecipients else hasRecipients

    Row(
        verticalAlignment = Alignment.CenterVertically,
        modifier = Modifier.fillMaxWidth().padding(vertical = 4.dp),
    ) {
        // Coin balance
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = Modifier.clickable { onNavigateToWallet() },
        ) {
            Text("\uD83E\uDE99", fontSize = 14.sp)
            Spacer(modifier = Modifier.width(4.dp))
            Text(
                "${state.coinBalance}",
                style = MaterialTheme.typography.titleSmall,
                fontWeight = FontWeight.ExtraBold,
                color = Color(0xFFFFD700),
            )
            Spacer(modifier = Modifier.width(2.dp))
            Text(
                "+",
                style = MaterialTheme.typography.labelSmall,
                fontWeight = FontWeight.Bold,
                color = CyanAccent,
            )
        }

        Spacer(modifier = Modifier.weight(1f))

        // Quantity chip
        TextButton(
            onClick = onQuantityClick,
            contentPadding = PaddingValues(horizontal = 12.dp, vertical = 4.dp),
            colors =
                ButtonDefaults.textButtonColors(
                    containerColor = MaterialTheme.colorScheme.surfaceVariant,
                ),
            modifier = Modifier.height(36.dp),
        ) {
            Text(
                "${state.selectedQuantity} \u25B2",
                fontWeight = FontWeight.Bold,
                fontSize = 13.sp,
            )
        }

        Spacer(modifier = Modifier.width(8.dp))

        // Send All button (only on backpack tab with exactly 1 recipient)
        if (onSendAllClick != null) {
            Button(
                onClick = onSendAllClick,
                enabled = hasRecipients && !state.isSending,
                colors =
                    ButtonDefaults.buttonColors(
                        containerColor = Color(0xFFD32F2F),
                        contentColor = Color.White,
                        disabledContainerColor = Color(0xFFD32F2F).copy(alpha = 0.3f),
                    ),
                modifier = Modifier.height(36.dp),
            ) {
                Text(
                    stringResource(Res.string.send_all),
                    fontWeight = FontWeight.Bold,
                    maxLines = 1,
                    fontSize = 12.sp,
                )
            }
            Spacer(modifier = Modifier.width(4.dp))
        }

        // Send button
        Button(
            onClick = onSendClick,
            enabled = canSend,
            colors =
                ButtonDefaults.buttonColors(
                    containerColor = CyanAccent,
                    contentColor = Color.Black,
                    disabledContainerColor = CyanAccent.copy(alpha = 0.3f),
                ),
            modifier = Modifier.height(36.dp),
        ) {
            Text(
                when {
                    state.isSending -> if (isSelfUse) stringResource(Res.string.using) else stringResource(Res.string.sending)
                    sendLabel != null -> sendLabel
                    else -> stringResource(Res.string.send)
                },
                fontWeight = FontWeight.Bold,
                maxLines = 1,
                overflow = TextOverflow.Ellipsis,
            )
        }
    }
}

// ── Quantity Picker Popup ──

@Composable
private fun QuantityPickerPopup(
    selectedGiftId: String?,
    backpackItems: List<BackpackItem>,
    coinBalance: Long,
    giftCatalog: List<Gift>,
    isBackpackTab: Boolean,
    selectedQuantity: Int,
    recipientCount: Int,
    onSelectQuantity: (Int) -> Unit,
    onDismiss: () -> Unit,
) {
    val gift = selectedGiftId?.let { id -> giftCatalog.find { it.id == id } }
    val ownedQty = selectedGiftId?.let { id -> backpackItems.find { it.giftId == id }?.quantity } ?: 0

    val presets =
        buildList {
            addAll(listOf(1, 10, 66, 520, 999, 1314))
            if (isBackpackTab && ownedQty > 0) {
                add(-1) // sentinel for "ALL"
            }
        }

    Popup(
        alignment = Alignment.BottomCenter,
        onDismissRequest = onDismiss,
        properties = PopupProperties(focusable = true),
    ) {
        Column(
            modifier =
                Modifier
                    .widthIn(min = 120.dp)
                    .padding(bottom = 48.dp)
                    .clip(RoundedCornerShape(12.dp))
                    .background(MaterialTheme.colorScheme.surfaceContainerHigh)
                    .padding(8.dp),
            horizontalAlignment = Alignment.CenterHorizontally,
        ) {
            presets.forEach { preset ->
                val isAll = preset == -1
                val qty = if (isAll) ownedQty else preset
                val label = if (isAll) stringResource(Res.string.quantity_all, ownedQty) else "$preset"
                val isSelected = qty == selectedQuantity

                val enabled =
                    if (isBackpackTab) {
                        gift != null && qty * recipientCount <= ownedQty
                    } else {
                        true
                    }

                TextButton(
                    onClick = { onSelectQuantity(qty) },
                    enabled = enabled,
                    modifier = Modifier.fillMaxWidth(),
                    colors =
                        ButtonDefaults.textButtonColors(
                            containerColor = if (isSelected) CyanAccent.copy(alpha = 0.2f) else Color.Transparent,
                            contentColor =
                                if (enabled) {
                                    MaterialTheme.colorScheme.onSurface
                                } else {
                                    MaterialTheme.colorScheme.onSurfaceVariant.copy(alpha = 0.4f)
                                },
                        ),
                ) {
                    Text(label, fontWeight = if (isSelected) FontWeight.Bold else FontWeight.Normal)
                }
            }
        }
    }
}

// ── Confirmation Dialog ──

@Composable
private fun ConfirmSendDialog(
    state: com.shyden.shytalk.feature.gifting.GiftingUiState,
    giftCatalog: List<Gift>,
    isBackpackTab: Boolean,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    val gift = state.selectedGiftId?.let { id -> giftCatalog.find { it.id == id } } ?: return
    val recipientCount = state.selectedRecipientIds.size
    val quantity = state.selectedQuantity
    val totalItems = quantity.toLong() * recipientCount

    AlertDialog(
        onDismissRequest = onDismiss,
        title = { Text(stringResource(Res.string.confirm_send)) },
        text = {
            Column {
                val headerText =
                    if (recipientCount > 1) {
                        stringResource(Res.string.send_gift_header_multiple, quantity, gift.name, recipientCount)
                    } else {
                        stringResource(Res.string.send_gift_header, quantity, gift.name)
                    }
                Text(
                    headerText,
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.height(12.dp))
                if (isBackpackTab) {
                    val ownedQty = state.backpackItems.find { it.giftId == gift.id }?.quantity ?: 0
                    Text(stringResource(Res.string.from_backpack_items, totalItems))
                    Text(stringResource(Res.string.you_have_count, ownedQty))
                } else {
                    val totalCost = gift.coinValue.toLong() * totalItems
                    Text(stringResource(Res.string.total_cost_coins, totalCost))
                    Text(stringResource(Res.string.your_balance_coins, state.coinBalance))
                }
            }
        },
        confirmButton = {
            TextButton(onClick = onConfirm) {
                Text(stringResource(Res.string.confirm), color = CyanAccent)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(Res.string.cancel))
            }
        },
    )
}

// ── Shared Composables ──

@Composable
fun GiftIcon(
    gift: Gift,
    size: Int,
) {
    if (gift.iconUrl.isNotBlank()) {
        AsyncImage(
            model = gift.iconUrl,
            contentDescription = gift.name,
            modifier = Modifier.size(size.dp).clip(CircleShape),
            contentScale = ContentScale.Crop,
        )
    } else {
        Box(
            modifier =
                Modifier
                    .size(size.dp)
                    .clip(CircleShape)
                    .background(MaterialTheme.colorScheme.primaryContainer),
            contentAlignment = Alignment.Center,
        ) {
            Text(
                gift.name.take(2),
                fontWeight = FontWeight.Bold,
                color = MaterialTheme.colorScheme.onPrimaryContainer,
                fontSize = (size / 3).sp,
            )
        }
    }
}

// ── Send All Confirmation Dialog ──

@Composable
private fun SendAllConfirmDialog(
    recipientName: String,
    totalItems: Int,
    uniqueGifts: Int,
    totalValue: Long = 0L,
    onConfirm: () -> Unit,
    onDismiss: () -> Unit,
) {
    AlertDialog(
        onDismissRequest = onDismiss,
        title = {
            Text(
                stringResource(Res.string.send_all_warning_title),
                color = Color(0xFFD32F2F),
                fontWeight = FontWeight.Black,
                fontSize = 20.sp,
            )
        },
        text = {
            Column {
                Text(
                    stringResource(Res.string.send_all_warning, recipientName),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Bold,
                )
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    stringResource(Res.string.send_all_includes, totalItems, uniqueGifts),
                    style = MaterialTheme.typography.bodyMedium,
                )
                if (totalValue > 0) {
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        stringResource(Res.string.send_all_total_value, totalValue),
                        style = MaterialTheme.typography.bodyMedium,
                        fontWeight = FontWeight.Bold,
                        color = Color(0xFFFFD700),
                    )
                }
                Spacer(modifier = Modifier.height(12.dp))
                Text(
                    stringResource(Res.string.action_cannot_be_undone),
                    style = MaterialTheme.typography.bodyLarge,
                    fontWeight = FontWeight.Black,
                    color = Color(0xFFD32F2F),
                )
            }
        },
        confirmButton = {
            Button(
                onClick = onConfirm,
                colors =
                    ButtonDefaults.buttonColors(
                        containerColor = Color(0xFFD32F2F),
                        contentColor = Color.White,
                    ),
            ) {
                Text(stringResource(Res.string.send_everything_confirm), fontWeight = FontWeight.Bold)
            }
        },
        dismissButton = {
            TextButton(onClick = onDismiss) {
                Text(stringResource(Res.string.cancel))
            }
        },
    )
}

/** Format large numbers in abbreviated form (e.g. 1.2K, 3.5M). */
private fun formatLargeNumber(value: Long): String {
    fun oneDecimal(v: Double): String {
        val rounded = (v * 10).toLong() / 10.0
        return if (rounded == rounded.toLong().toDouble()) {
            "${rounded.toLong()}.0"
        } else {
            rounded.toString().let { s -> s.substring(0, s.indexOf('.') + 2) }
        }
    }
    return when {
        value >= 1_000_000_000 -> "${oneDecimal(value / 1_000_000_000.0)}B"
        value >= 1_000_000 -> "${oneDecimal(value / 1_000_000.0)}M"
        value >= 10_000 -> "${oneDecimal(value / 1_000.0)}K"
        else -> "$value"
    }
}
