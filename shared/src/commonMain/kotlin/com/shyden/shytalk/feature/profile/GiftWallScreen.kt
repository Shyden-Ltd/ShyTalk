package com.shyden.shytalk.feature.profile

import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
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
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.ModalBottomSheet
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.Gift

@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GiftWallScreen(
    viewModel: GiftWallViewModel,
    onNavigateBack: () -> Unit,
    modifier: Modifier = Modifier
) {
    val state by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text("Gift Wall") },
                navigationIcon = {
                    IconButton(onClick = onNavigateBack) {
                        Icon(Icons.AutoMirrored.Filled.ArrowBack, contentDescription = "Back")
                    }
                }
            )
        },
        modifier = modifier
    ) { padding ->
        GiftWallContent(
            state = state,
            onSelectGift = { viewModel.selectGift(it) },
            onDismissDetails = { viewModel.dismissDetails() },
            modifier = Modifier.fillMaxSize().padding(padding)
        )
    }
}

/**
 * Reusable gift wall content that can be embedded in ProfileScreen tabs
 * or used standalone in GiftWallScreen.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun GiftWallContent(
    state: GiftWallUiState,
    onSelectGift: (String) -> Unit,
    onDismissDetails: () -> Unit,
    modifier: Modifier = Modifier
) {
    val scrollState = rememberScrollState()
    Column(
        modifier = modifier
            .testTag("giftWall_grid")
            .verticalScroll(scrollState)
            .padding(12.dp),
        verticalArrangement = Arrangement.spacedBy(8.dp)
    ) {
        val rows = state.giftCatalog.chunked(4)
        for (row in rows) {
            Row(
                modifier = Modifier.fillMaxWidth(),
                horizontalArrangement = Arrangement.spacedBy(8.dp)
            ) {
                for (gift in row) {
                    val wallEntry = state.wallEntries.find { it.giftId == gift.id }
                    val hasReceived = wallEntry != null && wallEntry.receivedCount > 0

                    Box(modifier = Modifier.weight(1f)) {
                        GiftWallItem(
                            gift = gift,
                            receivedCount = wallEntry?.receivedCount ?: 0,
                            isLit = hasReceived,
                            onClick = { if (hasReceived) onSelectGift(gift.id) }
                        )
                    }
                }
                // Fill remaining slots if row has < 4 items
                repeat(4 - row.size) {
                    Spacer(modifier = Modifier.weight(1f))
                }
            }
        }
    }

    // Gift detail bottom sheet
    state.selectedGiftId?.let { selectedId ->
        val gift = state.giftCatalog.find { it.id == selectedId }
        val wallEntry = state.wallEntries.find { it.giftId == selectedId }

        if (gift != null) {
            ModalBottomSheet(onDismissRequest = onDismissDetails) {
                Column(
                    modifier = Modifier.padding(24.dp),
                    horizontalAlignment = Alignment.CenterHorizontally
                ) {
                    Text(gift.name, style = MaterialTheme.typography.titleLarge, fontWeight = FontWeight.Bold)
                    Spacer(modifier = Modifier.height(8.dp))
                    Text(
                        "Received ${wallEntry?.receivedCount ?: 0} times",
                        style = MaterialTheme.typography.bodyMedium
                    )
                    Text(
                        "Value: ${gift.coinValue} coins",
                        style = MaterialTheme.typography.bodySmall,
                        color = MaterialTheme.colorScheme.onSurfaceVariant
                    )

                    if (state.senders.isNotEmpty()) {
                        Spacer(modifier = Modifier.height(16.dp))
                        Text("Top Senders", style = MaterialTheme.typography.titleSmall, fontWeight = FontWeight.Bold)
                        state.senders.take(5).forEach { sender ->
                            Text("${sender.userId.take(8)}... - ${sender.count}x",
                                style = MaterialTheme.typography.bodySmall)
                        }
                    }

                    Spacer(modifier = Modifier.height(24.dp))
                }
            }
        }
    }
}

@Composable
private fun GiftWallItem(
    gift: Gift,
    receivedCount: Int,
    isLit: Boolean,
    onClick: () -> Unit
) {
    val bracketColor = Color.Gray

    Column(
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier
            .aspectRatio(1f)
            .clip(RoundedCornerShape(8.dp))
            .background(
                if (isLit) bracketColor.copy(alpha = 0.1f)
                else MaterialTheme.colorScheme.surfaceVariant.copy(alpha = 0.3f)
            )
            .border(
                width = if (isLit) 2.dp else 1.dp,
                color = if (isLit) bracketColor else Color.Gray.copy(alpha = 0.3f),
                shape = RoundedCornerShape(8.dp)
            )
            .clickable(enabled = isLit) { onClick() }
            .padding(8.dp)
    ) {
        Box(contentAlignment = Alignment.Center) {
            if (gift.iconUrl.isNotBlank()) {
                AsyncImage(
                    model = gift.iconUrl,
                    contentDescription = gift.name,
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .then(if (!isLit) Modifier.background(Color.Gray.copy(alpha = 0.3f)) else Modifier),
                    contentScale = ContentScale.Crop,
                    alpha = if (isLit) 1f else 0.4f
                )
            } else {
                Box(
                    modifier = Modifier
                        .size(40.dp)
                        .clip(CircleShape)
                        .background(
                            if (isLit) bracketColor.copy(alpha = 0.2f)
                            else Color.Gray.copy(alpha = 0.1f)
                        ),
                    contentAlignment = Alignment.Center
                ) {
                    Text(
                        text = gift.name.take(2),
                        fontWeight = FontWeight.Bold,
                        color = if (isLit) bracketColor else Color.Gray,
                        fontSize = 14.sp
                    )
                }
            }
            // No-entry overlay for unreceived gifts
            if (!isLit) {
                Text(
                    text = "\uD83D\uDEAB",
                    fontSize = 20.sp,
                    modifier = Modifier.align(Alignment.Center)
                )
            }
        }
        Spacer(modifier = Modifier.height(4.dp))
        Text(
            text = gift.name,
            style = MaterialTheme.typography.labelSmall,
            maxLines = 1,
            textAlign = TextAlign.Center,
            color = if (isLit) MaterialTheme.colorScheme.onSurface else Color.Gray
        )
        if (receivedCount > 0) {
            Text(
                text = "x$receivedCount",
                style = MaterialTheme.typography.labelSmall,
                color = bracketColor,
                fontWeight = FontWeight.Bold
            )
        }
    }
}
