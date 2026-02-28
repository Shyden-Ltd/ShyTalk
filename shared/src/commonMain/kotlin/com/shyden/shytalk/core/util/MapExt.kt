package com.shyden.shytalk.core.util

/** Safely converts a value to Boolean, handling D1's integer booleans (0/1). */
fun Any?.asBool(default: Boolean = false): Boolean = when (this) {
    is Boolean -> this
    is Number -> toInt() != 0
    else -> default
}
