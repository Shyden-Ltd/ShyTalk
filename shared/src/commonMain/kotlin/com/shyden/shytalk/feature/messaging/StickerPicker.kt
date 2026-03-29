package com.shyden.shytalk.feature.messaging

import androidx.compose.foundation.ExperimentalFoundationApi
import androidx.compose.foundation.border
import androidx.compose.foundation.clickable
import androidx.compose.foundation.combinedClickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.lazy.grid.GridCells
import androidx.compose.foundation.lazy.grid.LazyVerticalGrid
import androidx.compose.foundation.lazy.grid.items
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Add
import androidx.compose.material3.AlertDialog
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.material3.TextButton
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.unit.dp
import coil3.compose.AsyncImage
import coil3.compose.LocalPlatformContext
import coil3.request.ImageRequest
import coil3.request.crossfade
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource

data class Sticker(
    val id: String,
    val url: String,
    val localPath: String? = null,
)

@Suppress("kotlin:S3776", "kotlin:S6615")
@OptIn(ExperimentalFoundationApi::class)
@Composable
fun StickerPicker(
    stickers: List<Sticker>,
    onStickerSelected: (Sticker) -> Unit,
    onAddSticker: (() -> Unit)? = null,
    onDeleteSticker: ((String) -> Unit)? = null,
    onMoveToFront: ((String) -> Unit)? = null,
    modifier: Modifier = Modifier,
) {
    var longPressedSticker by remember { mutableStateOf<Sticker?>(null) }

    Column(modifier = modifier.fillMaxWidth()) {
        if (stickers.isEmpty() && onAddSticker == null) {
            Surface(
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(200.dp),
                color = MaterialTheme.colorScheme.surfaceVariant,
            ) {
                Column(
                    modifier = Modifier.padding(16.dp),
                    horizontalAlignment = Alignment.CenterHorizontally,
                    verticalArrangement = Arrangement.Center,
                ) {
                    Text(
                        text = stringResource(Res.string.no_stickers_yet),
                        style = MaterialTheme.typography.bodyMedium,
                        color = MaterialTheme.colorScheme.onSurfaceVariant,
                    )
                }
            }
        } else {
            LazyVerticalGrid(
                columns = GridCells.Fixed(4),
                modifier =
                    Modifier
                        .fillMaxWidth()
                        .height(250.dp),
                contentPadding = PaddingValues(8.dp),
                horizontalArrangement = Arrangement.spacedBy(8.dp),
                verticalArrangement = Arrangement.spacedBy(8.dp),
            ) {
                if (onAddSticker != null) {
                    item {
                        Box(
                            modifier =
                                Modifier
                                    .size(72.dp)
                                    .clip(RoundedCornerShape(8.dp))
                                    .border(1.dp, MaterialTheme.colorScheme.outline, RoundedCornerShape(8.dp))
                                    .clickable { onAddSticker() },
                            contentAlignment = Alignment.Center,
                        ) {
                            Icon(
                                Icons.Default.Add,
                                contentDescription = null,
                                tint = MaterialTheme.colorScheme.primary,
                            )
                        }
                    }
                }
                items(stickers, key = { it.id }) { sticker ->
                    AsyncImage(
                        model =
                            ImageRequest
                                .Builder(LocalPlatformContext.current)
                                .data(sticker.localPath ?: sticker.url)
                                .crossfade(false)
                                .build(),
                        contentDescription = stringResource(Res.string.sticker),
                        modifier =
                            Modifier
                                .size(72.dp)
                                .clip(RoundedCornerShape(8.dp))
                                .combinedClickable(
                                    onClick = { onStickerSelected(sticker) },
                                    onLongClick = {
                                        if (onDeleteSticker != null || onMoveToFront != null) {
                                            longPressedSticker = sticker
                                        }
                                    },
                                ),
                        contentScale = ContentScale.Fit,
                    )
                }
            }
        }
    }

    longPressedSticker?.let { sticker ->
        AlertDialog(
            onDismissRequest = { longPressedSticker = null },
            title = { Text(stringResource(Res.string.sticker)) },
            text = {
                Column {
                    if (onMoveToFront != null) {
                        TextButton(onClick = {
                            onMoveToFront(sticker.id)
                            longPressedSticker = null
                        }) {
                            Text(stringResource(Res.string.move_to_front))
                        }
                    }
                    if (onDeleteSticker != null) {
                        TextButton(onClick = {
                            onDeleteSticker(sticker.id)
                            longPressedSticker = null
                        }) {
                            Text(stringResource(Res.string.delete), color = MaterialTheme.colorScheme.error)
                        }
                    }
                }
            },
            confirmButton = {},
            dismissButton = {
                TextButton(onClick = { longPressedSticker = null }) {
                    Text(stringResource(Res.string.cancel))
                }
            },
        )
    }
}
