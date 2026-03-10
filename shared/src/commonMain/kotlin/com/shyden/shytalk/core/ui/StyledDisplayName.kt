package com.shyden.shytalk.core.ui

import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.layout.width
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Star
import androidx.compose.material3.Icon
import androidx.compose.material3.LocalTextStyle
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.TextStyle
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.text.style.TextOverflow
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.super_shy
import org.jetbrains.compose.resources.stringResource

val SuperShyGold = Color(0xFFFFD700)

@Composable
fun StyledDisplayName(
    displayName: String,
    isSuperShy: Boolean,
    modifier: Modifier = Modifier,
    style: TextStyle = LocalTextStyle.current,
    maxLines: Int = 1,
    overflow: TextOverflow = TextOverflow.Ellipsis
) {
    if (isSuperShy) {
        Row(
            verticalAlignment = Alignment.CenterVertically,
            modifier = modifier
        ) {
            Icon(
                imageVector = Icons.Filled.Star,
                contentDescription = stringResource(Res.string.super_shy),
                tint = SuperShyGold,
                modifier = Modifier.size(style.fontSize.value.dp * 1.1f)
            )
            Spacer(modifier = Modifier.width(3.dp))
            Text(
                text = displayName,
                style = style.copy(
                    color = SuperShyGold,
                    fontWeight = FontWeight.Bold
                ),
                maxLines = maxLines,
                overflow = overflow
            )
        }
    } else {
        Text(
            text = displayName,
            style = style,
            maxLines = maxLines,
            overflow = overflow,
            modifier = modifier
        )
    }
}
