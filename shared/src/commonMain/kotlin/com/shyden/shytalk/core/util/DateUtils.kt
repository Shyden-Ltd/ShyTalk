package com.shyden.shytalk.core.util

import kotlinx.datetime.Instant
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

@OptIn(kotlin.time.ExperimentalTime::class)
fun calculateAge(dateOfBirthMillis: Long): Int {
    val tz = TimeZone.currentSystemDefault()
    val today = Instant.fromEpochMilliseconds(currentTimeMillis()).toLocalDateTime(tz).date
    val birth = Instant.fromEpochMilliseconds(dateOfBirthMillis).toLocalDateTime(tz).date
    var age = today.year - birth.year
    if (today.monthNumber < birth.monthNumber ||
        (today.monthNumber == birth.monthNumber && today.dayOfMonth < birth.dayOfMonth)
    ) {
        age--
    }
    return age
}

fun isAtLeast13(dateOfBirthMillis: Long): Boolean {
    return calculateAge(dateOfBirthMillis) >= 13
}

fun formatRelativeTime(timestampMs: Long): String {
    val diffMs = currentTimeMillis() - timestampMs
    val minutes = diffMs / 60_000
    val hours = minutes / 60
    val days = hours / 24
    return when {
        minutes < 1 -> "just now"
        minutes < 60 -> "$minutes min${if (minutes != 1L) "s" else ""} ago"
        hours < 24 -> "$hours hour${if (hours != 1L) "s" else ""} ago"
        else -> "$days day${if (days != 1L) "s" else ""} ago"
    }
}

fun formatSuspensionEnd(endDateMillis: Long): String {
    val remaining = endDateMillis - currentTimeMillis()
    if (remaining <= 0) return "Expired"
    val totalMinutes = remaining / 60_000
    val days = totalMinutes / 1440
    val hours = (totalMinutes % 1440) / 60
    val minutes = totalMinutes % 60
    val parts = mutableListOf<String>()
    if (days > 0) parts.add("$days day${if (days != 1L) "s" else ""}")
    if (hours > 0) parts.add("$hours hour${if (hours != 1L) "s" else ""}")
    if (minutes > 0) parts.add("$minutes minute${if (minutes != 1L) "s" else ""}")
    return parts.joinToString(", ").ifEmpty { "Less than 1 minute" }
}

fun formatSuspensionEndDateTime(endDateMillis: Long): String {
    val tz = TimeZone.currentSystemDefault()
    val dt = Instant.fromEpochMilliseconds(endDateMillis).toLocalDateTime(tz)
    val month = dt.month.name.lowercase().replaceFirstChar { it.uppercase() }.take(3)
    val day = dt.dayOfMonth
    val year = dt.year
    val hour = dt.hour.toString().padStart(2, '0')
    val minute = dt.minute.toString().padStart(2, '0')
    return "$month $day, $year at $hour:$minute"
}

fun formatDateForDisplay(millis: Long): String {
    val tz = TimeZone.currentSystemDefault()
    val date = Instant.fromEpochMilliseconds(millis).toLocalDateTime(tz).date
    val month = date.month.name.lowercase().replaceFirstChar { it.uppercase() }.take(3)
    return "$month ${date.dayOfMonth.toString().padStart(2, '0')}, ${date.year}"
}
