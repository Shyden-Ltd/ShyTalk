package com.shyden.shytalk.feature.room.components

import androidx.compose.foundation.border
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.PaddingValues
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.lazy.LazyRow
import androidx.compose.foundation.lazy.items
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Groups
import androidx.compose.material.icons.filled.Schedule
import androidx.compose.material3.Button
import androidx.compose.material3.HorizontalDivider
import androidx.compose.material3.Icon
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.geometry.Offset
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.Shadow
import androidx.compose.ui.layout.ContentScale
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextAlign
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import coil3.compose.AsyncImage
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.flagEmojiForCode
import com.shyden.shytalk.feature.room.RoomClosedSummary

@Composable
fun RoomClosedSummaryPanel(
    summary: RoomClosedSummary,
    onDismiss: () -> Unit,
    modifier: Modifier = Modifier
) {
    val hours = (summary.durationMs / 3_600_000).toInt()
    val minutes = ((summary.durationMs % 3_600_000) / 60_000).toInt()
    val durationText = when {
        hours > 0 -> "${hours}h ${minutes}m"
        minutes > 0 -> "${minutes}m"
        else -> "< 1m"
    }

    Column(
        modifier = modifier
            .fillMaxSize()
            .padding(vertical = 32.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.Center
    ) {
        val textShadow = Shadow(
            color = MaterialTheme.colorScheme.background,
            offset = Offset.Zero,
            blurRadius = 8f
        )

        Text(
            text = "Room Closed",
            style = MaterialTheme.typography.headlineMedium.copy(shadow = textShadow),
            fontWeight = FontWeight.Bold,
            color = MaterialTheme.colorScheme.onBackground,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(8.dp))

        Text(
            text = summary.roomName,
            style = MaterialTheme.typography.titleLarge.copy(shadow = textShadow),
            color = MaterialTheme.colorScheme.onSurfaceVariant,
            textAlign = TextAlign.Center
        )

        Spacer(modifier = Modifier.height(24.dp))

        HorizontalDivider(modifier = Modifier.padding(horizontal = 24.dp))

        Spacer(modifier = Modifier.height(24.dp))

        // Duration
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            Icon(
                imageVector = Icons.Default.Schedule,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "Open for $durationText",
                style = MaterialTheme.typography.bodyLarge.copy(shadow = textShadow),
                color = MaterialTheme.colorScheme.onBackground
            )
        }

        Spacer(modifier = Modifier.height(12.dp))

        // Total visitors
        Row(
            verticalAlignment = Alignment.CenterVertically,
            horizontalArrangement = Arrangement.Center
        ) {
            Icon(
                imageVector = Icons.Default.Groups,
                contentDescription = null,
                tint = MaterialTheme.colorScheme.primary,
                modifier = Modifier.size(24.dp)
            )
            Spacer(modifier = Modifier.width(8.dp))
            Text(
                text = "${summary.totalVisitors} visitor${if (summary.totalVisitors != 1) "s" else ""}",
                style = MaterialTheme.typography.bodyLarge.copy(shadow = textShadow),
                color = MaterialTheme.colorScheme.onBackground
            )
        }

        Spacer(modifier = Modifier.height(24.dp))

        HorizontalDivider(modifier = Modifier.padding(horizontal = 24.dp))

        Spacer(modifier = Modifier.height(24.dp))

        // Hosts section
        if (summary.hostUsers.isNotEmpty()) {
            Text(
                text = "Hosts",
                style = MaterialTheme.typography.titleMedium.copy(shadow = textShadow),
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 32.dp)
            )

            Spacer(modifier = Modifier.height(12.dp))

            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                contentPadding = PaddingValues(horizontal = 32.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                items(summary.hostUsers, key = { it.uid }) { host ->
                    UserChip(
                        user = host,
                        borderColor = MaterialTheme.colorScheme.primary
                    )
                }
            }
        }

        // Speakers section
        if (summary.speakerUsers.isNotEmpty()) {
            Spacer(modifier = Modifier.height(20.dp))

            Text(
                text = "Speakers",
                style = MaterialTheme.typography.titleMedium.copy(shadow = textShadow),
                fontWeight = FontWeight.SemiBold,
                color = MaterialTheme.colorScheme.onBackground,
                modifier = Modifier
                    .fillMaxWidth()
                    .padding(start = 32.dp)
            )

            Spacer(modifier = Modifier.height(12.dp))

            LazyRow(
                horizontalArrangement = Arrangement.spacedBy(16.dp),
                contentPadding = PaddingValues(horizontal = 32.dp),
                modifier = Modifier.fillMaxWidth()
            ) {
                items(summary.speakerUsers, key = { it.uid }) { speaker ->
                    UserChip(
                        user = speaker,
                        borderColor = MaterialTheme.colorScheme.tertiary
                    )
                }
            }
        }

        Spacer(modifier = Modifier.height(32.dp))

        Button(onClick = onDismiss) {
            Text("Back to Home")
        }
    }
}

@Composable
private fun UserChip(user: User, borderColor: Color) {
    Box(contentAlignment = Alignment.Center) {
        AsyncImage(
            model = user.photoUrl,
            contentDescription = user.displayName,
            modifier = Modifier
                .size(56.dp)
                .clip(CircleShape)
                .border(2.dp, borderColor, CircleShape),
            contentScale = ContentScale.Crop
        )
        val nationality = user.nationality
        if (nationality != null) {
            Box(
                modifier = Modifier
                    .align(Alignment.BottomEnd)
                    .size(22.dp),
                contentAlignment = Alignment.Center
            ) {
                Text(
                    text = flagEmojiForCode(nationality),
                    style = MaterialTheme.typography.labelSmall.copy(fontSize = 14.sp)
                )
            }
        }
    }
}
