package com.shyden.shytalk.core.util

import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

fun calculateAge(dateOfBirthMillis: Long): Int {
    val tz = TimeZone.currentSystemDefault()
    val today = Instant.fromEpochMilliseconds(currentTimeMillis()).toLocalDateTime(tz).date
    val birth = Instant.fromEpochMilliseconds(dateOfBirthMillis).toLocalDateTime(tz).date
    var age = today.year - birth.year
    if (today.month < birth.month ||
        (today.month == birth.month && today.day < birth.day)
    ) {
        age--
    }
    return age
}

fun isAtLeast13(dateOfBirthMillis: Long): Boolean = calculateAge(dateOfBirthMillis) >= 13

/**
 * Localized labels for [formatRelativeTime].
 * In Composable callers, construct via [RelativeTimeStrings.fromResources].
 * English defaults allow direct use in tests and non-UI code.
 */
data class RelativeTimeStrings(
    val justNow: String = "just now",
    val minutesAgo: (Long) -> String = { m -> "$m min${if (m != 1L) "s" else ""} ago" },
    val hoursAgo: (Long) -> String = { h -> "$h hour${if (h != 1L) "s" else ""} ago" },
    val daysAgo: (Long) -> String = { d -> "$d day${if (d != 1L) "s" else ""} ago" },
)

/**
 * Localized labels for [formatSuspensionEnd].
 * In Composable callers, construct via [SuspensionTimeStrings.fromResources].
 * English defaults allow direct use in tests and non-UI code.
 */
data class SuspensionTimeStrings(
    val expired: String = "Expired",
    val days: (Long) -> String = { d -> "$d day${if (d != 1L) "s" else ""}" },
    val hours: (Long) -> String = { h -> "$h hour${if (h != 1L) "s" else ""}" },
    val minutes: (Long) -> String = { m -> "$m minute${if (m != 1L) "s" else ""}" },
    val lessThanMinute: String = "Less than 1 minute",
)

fun formatRelativeTime(
    timestampMs: Long,
    strings: RelativeTimeStrings = RelativeTimeStrings(),
): String {
    val diffMs = currentTimeMillis() - timestampMs
    val minutes = diffMs / 60_000
    val hours = minutes / 60
    val days = hours / 24
    return when {
        minutes < 1 -> strings.justNow
        minutes < 60 -> strings.minutesAgo(minutes)
        hours < 24 -> strings.hoursAgo(hours)
        else -> strings.daysAgo(days)
    }
}

fun formatSuspensionEnd(
    endDateMillis: Long,
    strings: SuspensionTimeStrings = SuspensionTimeStrings(),
): String {
    val remaining = endDateMillis - currentTimeMillis()
    if (remaining <= 0) return strings.expired
    val totalMinutes = remaining / 60_000
    val days = totalMinutes / 1440
    val hours = (totalMinutes % 1440) / 60
    val minutes = totalMinutes % 60
    val parts = mutableListOf<String>()
    if (days > 0) parts.add(strings.days(days))
    if (hours > 0) parts.add(strings.hours(hours))
    if (minutes > 0) parts.add(strings.minutes(minutes))
    return parts.joinToString(", ").ifEmpty { strings.lessThanMinute }
}

fun formatSuspensionEndDateTime(endDateMillis: Long): String {
    val tz = TimeZone.currentSystemDefault()
    val dt = Instant.fromEpochMilliseconds(endDateMillis).toLocalDateTime(tz)
    val month =
        dt.month.name
            .lowercase()
            .replaceFirstChar { it.uppercase() }
            .take(3)
    val day = dt.day
    val year = dt.year
    val hour = dt.hour.toString().padStart(2, '0')
    val minute = dt.minute.toString().padStart(2, '0')
    return "$month $day, $year at $hour:$minute"
}

fun formatDateForDisplay(millis: Long): String {
    val tz = TimeZone.currentSystemDefault()
    val date = Instant.fromEpochMilliseconds(millis).toLocalDateTime(tz).date
    val month =
        date.month.name
            .lowercase()
            .replaceFirstChar { it.uppercase() }
            .take(3)
    return "$month ${date.day.toString().padStart(2, '0')}, ${date.year}"
}
