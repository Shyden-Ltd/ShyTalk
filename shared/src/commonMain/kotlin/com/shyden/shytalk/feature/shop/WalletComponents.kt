package com.shyden.shytalk.feature.shop

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Row
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Text
import androidx.compose.runtime.Composable
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import com.shyden.shytalk.core.model.CurrencyType
import com.shyden.shytalk.core.model.Transaction
import com.shyden.shytalk.core.model.TransactionType
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.*
import org.jetbrains.compose.resources.stringResource
import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

@Composable
internal fun TransactionRow(transaction: Transaction) {
    Row(
        modifier = Modifier
            .fillMaxWidth()
            .padding(vertical = 6.dp),
        verticalAlignment = Alignment.CenterVertically
    ) {
        Text(
            text = transactionIcon(transaction.type),
            style = MaterialTheme.typography.titleMedium
        )
        Spacer(modifier = Modifier.width(12.dp))
        Column(modifier = Modifier.weight(1f)) {
            Text(
                text = transactionLabel(transaction),
                style = MaterialTheme.typography.bodyMedium
            )
            Text(
                text = formatTimestamp(transaction.timestamp),
                style = MaterialTheme.typography.bodySmall,
                color = MaterialTheme.colorScheme.onSurfaceVariant
            )
        }
        val isPositive = transaction.amount > 0
        Text(
            text = "${if (isPositive) "+" else ""}${transaction.amount}",
            style = MaterialTheme.typography.bodyMedium,
            fontWeight = FontWeight.Bold,
            color = if (isPositive) Color(0xFF4CAF50) else MaterialTheme.colorScheme.error
        )
        Spacer(modifier = Modifier.width(4.dp))
        Text(
            text = if (transaction.currency == CurrencyType.BEANS) "\uD83E\uDED8" else "\uD83E\uDE99",
            style = MaterialTheme.typography.bodySmall
        )
    }
}

internal fun transactionIcon(type: TransactionType): String = when (type) {
    TransactionType.PURCHASE -> "\uD83D\uDCB3"
    TransactionType.GACHA_PULL -> "\uD83C\uDFB0"
    TransactionType.GIFT_SENT -> "\uD83C\uDF81"
    TransactionType.GIFT_RECEIVED -> "\uD83C\uDF89"
    TransactionType.BEAN_REDEEM -> "\uD83E\uDED8"
    TransactionType.DAILY_REWARD -> "\uD83D\uDCC5"
    TransactionType.SUBSCRIPTION -> "\u2B50"
    TransactionType.ADMIN_ADJUSTMENT -> "\uD83D\uDD27"
    TransactionType.ADMIN_BACKPACK -> "\uD83C\uDF92"
}

private val uidPattern = Regex("""\(by [a-zA-Z0-9]{20,}\)""")

internal fun transactionLabel(transaction: Transaction): String {
    val details = transaction.details
    if (!details.isNullOrBlank()) {
        return details.replace(uidPattern, "(by ShyTalk Official)")
    }
    return when (transaction.type) {
        TransactionType.PURCHASE -> "Coin purchase"
        TransactionType.GACHA_PULL -> "Gacha pull${transaction.pullCount?.let { " (x$it)" } ?: ""}"
        TransactionType.GIFT_SENT -> "Sent ${transaction.giftName ?: "gift"}"
        TransactionType.GIFT_RECEIVED -> "Received ${transaction.giftName ?: "gift"}"
        TransactionType.BEAN_REDEEM -> "Bean redemption"
        TransactionType.DAILY_REWARD -> "Daily reward"
        TransactionType.SUBSCRIPTION -> "Super Shy"
        TransactionType.ADMIN_ADJUSTMENT -> "Adjustment"
        TransactionType.ADMIN_BACKPACK -> "Backpack item"
    }
}

internal fun formatNumber(value: Long): String {
    val s = value.toString()
    val result = StringBuilder()
    val startIndex = if (s.startsWith('-')) 1 else 0
    val digits = s.substring(startIndex)
    for (i in digits.indices) {
        if (i > 0 && (digits.length - i) % 3 == 0) result.append(',')
        result.append(digits[i])
    }
    return if (startIndex == 1) "-$result" else result.toString()
}

internal fun formatTimestamp(millis: Long): String {
    if (millis == 0L) return ""
    val now = com.shyden.shytalk.core.util.currentTimeMillis()
    val diff = now - millis
    return when {
        diff < 60_000 -> "Just now"
        diff < 3_600_000 -> "${diff / 60_000}m ago"
        diff < 86_400_000 -> "${diff / 3_600_000}h ago"
        diff < 604_800_000 -> "${diff / 86_400_000}d ago"
        else -> {
            val instant = Instant.fromEpochMilliseconds(millis)
            val local = instant.toLocalDateTime(TimeZone.currentSystemDefault())
            "${local.dayOfMonth}/${local.monthNumber}/${local.year}"
        }
    }
}
