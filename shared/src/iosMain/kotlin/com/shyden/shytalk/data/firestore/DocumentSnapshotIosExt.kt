@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package com.shyden.shytalk.data.firestore

import cocoapods.FirebaseCore.FIRTimestamp
import cocoapods.FirebaseFirestoreInternal.FIRGeoPoint
import dev.gitlive.firebase.firestore.DocumentSnapshot
import dev.gitlive.firebase.firestore.ios
import kotlinx.cinterop.toKString
import platform.Foundation.NSArray
import platform.Foundation.NSDictionary
import platform.Foundation.NSNull
import platform.Foundation.NSNumber

/**
 * Returns the document data as a `Map<String, Any?>`.
 *
 * Direct workaround for the gitlive Firebase Firestore SDK 2.4.0 issue on Kotlin/Native:
 * `doc.data<Map<String, Any?>>()` fails with "Serializer for class 'Any' is not found"
 * because kotlinx.serialization can't synthesise a serializer for `Any?` without reflection.
 *
 * This helper uses the public `DocumentSnapshot.ios: FIRDocumentSnapshot` property
 * to access the raw NSDictionary and convert it manually to native Kotlin types.
 */
fun DocumentSnapshot.dataMap(): Map<String, Any?> {
    val nsDict = ios.data() ?: return emptyMap()

    @Suppress("UNCHECKED_CAST")
    val rawMap = nsDict as Map<Any?, Any?>
    return rawMap.entries.associate { (k, v) -> (k as String) to convertValue(v) }
}

private fun convertValue(value: Any?): Any? =
    when (value) {
        null, is NSNull -> null

        is FIRTimestamp -> (value.seconds * 1000L) + (value.nanoseconds / 1_000_000L)

        is FIRGeoPoint -> mapOf("latitude" to value.latitude, "longitude" to value.longitude)

        is NSDictionary -> {
            @Suppress("UNCHECKED_CAST")
            val raw = value as Map<Any?, Any?>
            raw.entries.associate { (k, v) -> (k as String) to convertValue(v) }
        }

        is NSArray -> {
            @Suppress("UNCHECKED_CAST")
            val raw = value as List<Any?>
            raw.map { convertValue(it) }
        }

        is NSNumber -> nsNumberToKotlin(value)

        else -> value
    }

/**
 * Convert NSNumber to a Kotlin primitive that satisfies `as? Number` / `as? Boolean`
 * casts in commonMain code. NSNumber does NOT extend kotlin.Number on Kotlin/Native
 * — without this conversion, `(map["uniqueId"] as? Number)?.toLong() ?: 0L` would
 * silently fall through to 0 for every numeric Firestore field.
 *
 * Boolean is detected via objCType: NSNumber numberWithBool: stores type "c" (signed
 * char). Floating-point types ("f"/"d") become Double. Everything else (integer
 * widths "i"/"l"/"q"/"s") becomes Long.
 */
private fun nsNumberToKotlin(value: NSNumber): Any {
    val type = value.objCType?.toKString()
    return when (type) {
        "c", "B" -> value.boolValue
        "f", "d" -> value.doubleValue
        else -> value.longLongValue
    }
}
