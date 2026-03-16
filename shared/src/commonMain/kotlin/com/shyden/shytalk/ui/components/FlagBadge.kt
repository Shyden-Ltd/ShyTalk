package com.shyden.shytalk.ui.components

import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Surface
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.unit.Dp
import androidx.compose.ui.unit.dp
import androidx.compose.ui.unit.sp
import androidx.compose.ui.window.Popup
import com.shyden.shytalk.core.util.countryNameForCode
import com.shyden.shytalk.core.util.flagEmojiForCode

@Composable
fun FlagBadge(
    countryCode: String,
    badgeSize: Dp = 24.dp,
    modifier: Modifier = Modifier,
) {
    var showTooltip by remember { mutableStateOf(false) }
    val flag = flagEmojiForCode(countryCode)
    val countryName = countryNameForCode(countryCode)

    Box(modifier = modifier) {
        Box(
            modifier =
                Modifier
                    .size(badgeSize)
                    .clickable { showTooltip = !showTooltip },
            contentAlignment = Alignment.Center,
        ) {
            Text(
                text = flag,
                style =
                    MaterialTheme.typography.labelSmall.copy(
                        fontSize = (badgeSize.value * 0.65f).sp,
                    ),
            )
        }

        if (showTooltip && countryName != null) {
            Popup(
                alignment = Alignment.TopCenter,
                onDismissRequest = { showTooltip = false },
            ) {
                Surface(
                    shape = RoundedCornerShape(6.dp),
                    color = MaterialTheme.colorScheme.inverseSurface,
                    shadowElevation = 4.dp,
                ) {
                    Text(
                        text = countryName,
                        style = MaterialTheme.typography.labelSmall,
                        color = MaterialTheme.colorScheme.inverseOnSurface,
                        modifier = Modifier.padding(horizontal = 8.dp, vertical = 4.dp),
                    )
                }
            }
        }
    }
}
