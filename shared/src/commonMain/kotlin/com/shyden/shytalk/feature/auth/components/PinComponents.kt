package com.shyden.shytalk.feature.auth.components

import androidx.compose.foundation.background
import androidx.compose.foundation.clickable
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.size
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.filled.Backspace
import androidx.compose.material.icons.filled.Fingerprint
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.draw.clip
import androidx.compose.ui.semantics.contentDescription
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.stateDescription
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource

private val KEYPAD_ROWS =
    listOf(
        listOf('1', '2', '3'),
        listOf('4', '5', '6'),
        listOf('7', '8', '9'),
    )

@Composable
fun PinDots(
    length: Int,
    maxLength: Int,
    modifier: Modifier = Modifier,
) {
    val dotsState = stringResource(Res.string.pin_dots_state, length, maxLength)
    Row(
        modifier =
            modifier.semantics {
                stateDescription = dotsState
            },
        horizontalArrangement = Arrangement.spacedBy(12.dp),
    ) {
        repeat(maxLength.coerceAtMost(8)) { i ->
            Box(
                modifier =
                    Modifier
                        .size(16.dp)
                        .clip(CircleShape)
                        .background(
                            if (i < length) {
                                MaterialTheme.colorScheme.primary
                            } else {
                                MaterialTheme.colorScheme.outlineVariant
                            },
                        ),
            )
        }
    }
}

@Composable
fun PinKeypad(
    onDigit: (Char) -> Unit,
    onBackspace: () -> Unit,
    onBiometric: (() -> Unit)?,
    modifier: Modifier = Modifier,
) {
    Column(
        modifier = modifier,
        horizontalAlignment = Alignment.CenterHorizontally,
        verticalArrangement = Arrangement.spacedBy(8.dp),
    ) {
        KEYPAD_ROWS.forEach { row ->
            Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
                row.forEach { digit ->
                    KeypadButton(text = digit.toString(), onClick = { onDigit(digit) })
                }
            }
        }

        // Bottom row: biometric / 0 / backspace
        Row(horizontalArrangement = Arrangement.spacedBy(16.dp)) {
            if (onBiometric != null) {
                IconButton(
                    onClick = onBiometric,
                    modifier = Modifier.size(64.dp),
                ) {
                    Icon(
                        Icons.Default.Fingerprint,
                        contentDescription = stringResource(Res.string.pin_use_biometric),
                        modifier = Modifier.size(32.dp),
                        tint = MaterialTheme.colorScheme.primary,
                    )
                }
            } else {
                Spacer(Modifier.size(64.dp))
            }

            KeypadButton(text = "0", onClick = { onDigit('0') })

            IconButton(
                onClick = onBackspace,
                modifier = Modifier.size(64.dp),
            ) {
                Icon(
                    Icons.Default.Backspace,
                    contentDescription = stringResource(Res.string.pin_delete),
                    modifier = Modifier.size(24.dp),
                    tint = MaterialTheme.colorScheme.onSurface,
                )
            }
        }
    }
}

@Composable
private fun KeypadButton(
    text: String,
    onClick: () -> Unit,
    modifier: Modifier = Modifier,
) {
    Box(
        modifier =
            modifier
                .size(64.dp)
                .clip(CircleShape)
                .background(MaterialTheme.colorScheme.surfaceVariant)
                .clickable(onClick = onClick)
                .semantics { contentDescription = text },
        contentAlignment = Alignment.Center,
    ) {
        Text(
            text = text,
            style = MaterialTheme.typography.headlineSmall,
            color = MaterialTheme.colorScheme.onSurface,
        )
    }
}
