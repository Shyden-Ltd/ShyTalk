package com.shyden.shytalk.util

import java.text.SimpleDateFormat
import java.util.Date
import java.util.Locale
import java.util.TimeZone

/**
 * Formats the watermark's build/install timestamp (SHY-0205) as
 * `MM-dd HH:mm` — compact enough for the badge, precise enough to spot
 * a stale install at a glance.
 *
 * Fed from `PackageInfo.lastUpdateTime` (install time) rather than a
 * build-time constant: `installLocalDebug` always reinstalls right
 * after building in the QA loop, and install time cannot go stale under
 * gradle's configuration cache the way a baked timestamp can.
 *
 * Device-local zone by default — the human reading the badge is holding
 * the device.
 */
fun formatBuiltAt(
    epochMillis: Long,
    timeZone: TimeZone = TimeZone.getDefault(),
): String {
    val format = SimpleDateFormat("MM-dd HH:mm", Locale.US)
    format.timeZone = timeZone
    return format.format(Date(epochMillis))
}
