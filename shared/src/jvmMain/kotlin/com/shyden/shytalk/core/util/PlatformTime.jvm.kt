package com.shyden.shytalk.core.util

actual fun currentTimeMillis(): Long = System.currentTimeMillis()

actual fun timestampToMillis(value: Any?): Long =
    when (value) {
        is Long -> value
        is Number -> value.toLong()
        null -> currentTimeMillis()
        else -> currentTimeMillis()
    }

actual fun millisToTimestamp(millis: Long): Any = millis

actual fun nowTimestamp(): Any = currentTimeMillis()
