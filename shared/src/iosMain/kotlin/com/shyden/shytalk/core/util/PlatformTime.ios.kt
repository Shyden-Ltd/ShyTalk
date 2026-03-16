package com.shyden.shytalk.core.util

import platform.Foundation.NSDate
import platform.Foundation.timeIntervalSince1970

actual fun currentTimeMillis(): Long = (NSDate().timeIntervalSince1970 * 1000).toLong()

actual fun timestampToMillis(value: Any?): Long =
    when (value) {
        is Long -> value
        is Double -> value.toLong()
        is String -> value.toLongOrNull() ?: value.toDoubleOrNull()?.toLong() ?: currentTimeMillis()
        null -> currentTimeMillis()
        else -> currentTimeMillis()
    }

actual fun millisToTimestamp(millis: Long): Any = millis

actual fun nowTimestamp(): Any = currentTimeMillis()
