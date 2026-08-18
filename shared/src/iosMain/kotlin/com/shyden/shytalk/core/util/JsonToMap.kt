package com.shyden.shytalk.core.util

import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonElement
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.doubleOrNull
import kotlinx.serialization.json.longOrNull
import kotlin.math.floor

// A `JsonElement` as the plain Kotlin value the model `fromMap` functions
// expect — the same shapes Firestore's `dataMap()` produces, so moving a read
// from Firestore to the API does not require touching the models.
//
// `JsonNull` MUST be matched before `JsonPrimitive`: it is a subtype, and
// testing the general case first turns every null into the string "null".
//
// A Double needs care. Firestore and JSON both hand integers back as one, and
// `50000010.0.toString()` is "5.000001E7" — a document id that does not exist,
// which is an empty screen from a brand-new cause.
internal fun jsonToAny(el: JsonElement): Any? =
    when {
        el is JsonNull -> null
        el is JsonPrimitive ->
            when {
                el.isString -> el.content
                else -> el.booleanOrNull ?: el.longOrNull ?: el.doubleOrNull?.let(::wholeIfIntegral) ?: el.content
            }
        el is JsonArray -> el.map { jsonToAny(it) }
        el is JsonObject -> jsonToMap(el)
        else -> null
    }

private fun wholeIfIntegral(d: Double): Any = if (d == floor(d) && !d.isInfinite()) d.toLong() else d

/** A JSON object as a plain `Map<String, Any?>`. */
internal fun jsonToMap(obj: JsonObject): Map<String, Any?> = obj.mapValues { jsonToAny(it.value) }
