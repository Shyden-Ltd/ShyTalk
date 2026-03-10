package com.shyden.shytalk.core.util

import org.json.JSONArray
import org.json.JSONObject

/** Converts a JSONObject to a Map<String, Any?> compatible with model fromMap() factories.
 *  Converts snake_case keys from REST API to camelCase expected by model fromMap(). */
fun JSONObject.toMap(): Map<String, Any?> {
    val map = mutableMapOf<String, Any?>()
    keys().forEach { key ->
        map[snakeToCamel(key)] = convertValue(get(key))
    }
    return map
}

private fun snakeToCamel(s: String): String {
    if (!s.contains('_')) return s
    return buildString {
        var capitalizeNext = false
        for (c in s) {
            if (c == '_') {
                capitalizeNext = true
            } else {
                append(if (capitalizeNext) c.uppercaseChar() else c)
                capitalizeNext = false
            }
        }
    }
}

/** Converts a JSONArray to a List<Any?>. */
fun JSONArray.toList(): List<Any?> {
    return (0 until length()).map { convertValue(get(it)) }
}

private fun convertValue(value: Any?): Any? = when (value) {
    JSONObject.NULL, null -> null
    is JSONObject -> value.toMap()
    is JSONArray -> value.toList()
    // Normalize Int to Long to match Firestore convention (model fromMap() casts to Long)
    is Int -> value.toLong()
    else -> value // String, Long, Double, Boolean
}

