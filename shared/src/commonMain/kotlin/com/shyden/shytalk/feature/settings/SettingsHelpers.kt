package com.shyden.shytalk.feature.settings

/** Censor an email address for display (e.g. "te*t@example.com"). */
internal fun censorEmail(email: String): String {
    val parts = email.split("@", limit = 2)
    if (parts.size != 2) return email
    val local = parts[0]
    val domain = parts[1]
    val censored =
        when {
            local.length <= 2 -> "${local.first()}*"
            else -> "${local.take(2)}${"*".repeat((local.length - 3).coerceAtLeast(1))}${local.last()}"
        }
    return "$censored@$domain"
}

/** Format a cache size in bytes to a human-readable string. */
internal fun formatCacheSize(bytes: Long): String =
    when {
        bytes < 1024 -> "$bytes B"

        bytes < 1024 * 1024 -> "${bytes / 1024} KB"

        else -> {
            val mb = bytes / (1024.0 * 1024.0)
            val rounded = (mb * 10).toLong() / 10.0
            if (rounded == rounded.toLong().toDouble()) {
                "${rounded.toLong()}.0 MB"
            } else {
                "$rounded MB"
            }
        }
    }

/** Format hours and minutes as HH:MM with zero-padding. */
internal fun formatTime(
    hour: Int,
    minute: Int,
): String = "${hour.toString().padStart(2, '0')}:${minute.toString().padStart(2, '0')}"
