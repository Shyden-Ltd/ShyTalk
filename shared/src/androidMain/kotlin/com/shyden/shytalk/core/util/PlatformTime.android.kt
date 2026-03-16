package com.shyden.shytalk.core.util

import com.google.firebase.Timestamp
import java.util.Date

actual fun currentTimeMillis(): Long = System.currentTimeMillis()

actual fun timestampToMillis(value: Any?): Long =
    when (value) {
        is Timestamp -> value.toDate().time
        is Long -> value
        is Double -> value.toLong()
        is String -> value.toLongOrNull() ?: value.toDoubleOrNull()?.toLong() ?: currentTimeMillis()
        null -> currentTimeMillis()
        else -> currentTimeMillis()
    }

actual fun millisToTimestamp(millis: Long): Any = Timestamp(Date(millis))

actual fun nowTimestamp(): Any = Timestamp.now()
