package com.shyden.shytalk.core.util

import androidx.compose.runtime.Composable
import androidx.compose.runtime.remember
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import org.jetbrains.compose.resources.stringResource

/** Sentinel value used to extract localized templates from format strings. */
private const val SENTINEL = 999888

/**
 * Build a lambda that produces localized text for a given count, by:
 * 1. Resolving stringResource with a sentinel value to get the full template
 * 2. Replacing the sentinel in the result to create a reusable template
 */
private fun buildFormatter(resolved: String): (Long) -> String {
    val template = resolved.replace(SENTINEL.toString(), "\u0000")
    return { n -> template.replace("\u0000", n.toString()) }
}

/**
 * Resolves [RelativeTimeStrings] from Compose string resources.
 * Call from any @Composable scope, then pass to [formatRelativeTime].
 */
@Composable
fun rememberRelativeTimeStrings(): RelativeTimeStrings {
    val justNow = stringResource(Res.string.time_just_now)
    val minFmt = stringResource(Res.string.time_minutes_ago, SENTINEL)
    val hrFmt = stringResource(Res.string.time_hours_ago, SENTINEL)
    val dayFmt = stringResource(Res.string.time_days_ago, SENTINEL)

    return remember(justNow, minFmt, hrFmt, dayFmt) {
        RelativeTimeStrings(
            justNow = justNow,
            minutesAgo = buildFormatter(minFmt),
            hoursAgo = buildFormatter(hrFmt),
            daysAgo = buildFormatter(dayFmt),
        )
    }
}

/**
 * Resolves [SuspensionTimeStrings] from Compose string resources.
 * Call from any @Composable scope, then pass to [formatSuspensionEnd].
 */
@Composable
fun rememberSuspensionTimeStrings(): SuspensionTimeStrings {
    val expired = stringResource(Res.string.time_expired)
    val dayFmt = stringResource(Res.string.time_days, SENTINEL)
    val hrFmt = stringResource(Res.string.time_hours, SENTINEL)
    val minFmt = stringResource(Res.string.time_minutes, SENTINEL)
    val lessThan = stringResource(Res.string.time_less_than_minute)

    return remember(expired, dayFmt, hrFmt, minFmt, lessThan) {
        SuspensionTimeStrings(
            expired = expired,
            days = buildFormatter(dayFmt),
            hours = buildFormatter(hrFmt),
            minutes = buildFormatter(minFmt),
            lessThanMinute = lessThan,
        )
    }
}
