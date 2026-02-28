package com.shyden.shytalk.core.util

import org.json.JSONArray
import org.json.JSONObject

/** Converts a JSONObject to a Map<String, Any?> compatible with model fromMap() factories. */
fun JSONObject.toMap(): Map<String, Any?> {
    val map = mutableMapOf<String, Any?>()
    keys().forEach { key ->
        map[key] = convertValue(get(key))
    }
    return map
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
