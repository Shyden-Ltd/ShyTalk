package com.shyden.shytalk.core.util

private const val LOG_TAG = "MapExt"

// Test-injectable type-drift sink. Production callers go through the
// real `logW` so a Firestore field arriving as the wrong shape (e.g.
// a String "true" landing in `isSuspended`) emits a Sentry-visible
// warning instead of silently coercing to `default`. Several call
// sites read security gates (`isSuspended`, `suspensionCanAppeal`,
// `ageVerified`, `pmLocked`); silent type drift on those would let a
// corrupted doc bypass a gate without anyone noticing.
internal var asBoolTypeDriftLogger: (typeName: String, default: Boolean) -> Unit =
    { typeName, default ->
        logW(
            LOG_TAG,
            "asBool type drift: expected Boolean/Number, got $typeName, returning default=$default",
        )
    }

/** Safely converts a value to Boolean, handling integer booleans (0/1). */
fun Any?.asBool(default: Boolean = false): Boolean =
    when (this) {
        is Boolean -> this

        is Number -> toInt() != 0

        null -> default

        else -> {
            asBoolTypeDriftLogger(this::class.simpleName ?: "Unknown", default)
            default
        }
    }

// Test-injectable id type-drift sink — same idea as `asBoolTypeDriftLogger`
// above, for the same reason: silence is what made this expensive.
internal var asIdTypeDriftLogger: (field: String, typeName: String) -> Unit =
    { field, typeName ->
        logW(LOG_TAG, "asIdSet type drift: $field contained a $typeName, coerced to String")
    }

/**
 * One user id from a Firestore array element, as a String.
 *
 * Ids are STRINGLY typed everywhere it matters — they address documents
 * (`users/{uniqueId}`) and key the maps the follow lists look members up in.
 * But the API writes them as NUMBERS: `users.js` builds
 * `followingIds: FieldValue.arrayUnion(targetId)` from
 * `Number.parseInt(...)`. Reading those arrays with
 * `filterIsInstance<String>()` therefore discarded every id the API ever
 * wrote, silently, and the follow lists rendered empty for everyone
 * (SHY-0338 — measured on-device: a document with 7 followers and 5 following
 * produced "Loaded 1 followers, 0 following").
 *
 * A Double needs care: Firestore may hand an integer back as one, and
 * `50000010.0.toString()` is "5.000001E7" — a document id that does not
 * exist, i.e. an empty list again from a fresh cause.
 */
fun Any?.asIdString(field: String = "id"): String? =
    when (this) {
        null -> null

        is String -> takeIf { it.isNotBlank() }

        is Int -> toString()

        is Long -> toString()

        is Double -> {
            asIdTypeDriftLogger(field, "Double")
            if (this == kotlin.math.floor(this) && !this.isInfinite()) toLong().toString() else toString()
        }

        is Float -> {
            asIdTypeDriftLogger(field, "Float")
            val d = toDouble()
            if (d == kotlin.math.floor(d) && !d.isInfinite()) d.toLong().toString() else toString()
        }

        else -> {
            asIdTypeDriftLogger(field, this::class.simpleName ?: "unknown")
            toString().takeIf { it.isNotBlank() }
        }
    }

/** A Firestore array of user ids as Strings, whatever type each element arrived as. */
fun Any?.asIdSet(field: String = "ids"): Set<String> = (this as? List<*>)?.mapNotNull { it.asIdString(field) }?.toSet() ?: emptySet()
