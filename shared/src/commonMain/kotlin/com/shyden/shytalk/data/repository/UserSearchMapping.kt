package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.User
import kotlinx.serialization.json.JsonNull
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

/**
 * Shared post-fetch mapping for the cohort-gated DM user-search response
 * (`GET /api/users/search?q=...`, SHY-0137). Lives in commonMain so the Android
 * (`PrivateMessageRepositoryImpl`) and iOS (`IosPrivateMessageRepositoryImpl`)
 * repositories share ONE copy of this logic — previously each impl duplicated
 * it, and the iOS copy had ZERO test coverage (it can't be reached from
 * commonTest because iosMain isn't visible there). Both platforms now convert
 * their platform JSON (`org.json.JSONArray` / `kotlinx.serialization.JsonArray`)
 * into `List<Map<String, Any?>>` and call [mapUserSearchRows], so the core
 * parsing is covered once in `commonTest` for both targets.
 *
 * @param rows the per-user field maps already flattened from the response's
 *   `users` array (Android via `JSONObject.toMap()`, iOS via [jsonObjectToMap]).
 * @param currentUserId the caller's own uid — excluded from the results so the
 *   user can't start a DM thread with themselves.
 * @return the parsed [User] models, in input order, with rows dropped when:
 *   - `uniqueId` is absent or non-numeric (the Firestore doc id == the
 *     stringified `uniqueId`, so without it there is no resolvable [User.uid]);
 *   - the resolved uid equals [currentUserId];
 *   - [User.fromMap] throws on a malformed row (defensive — a single bad row
 *     must not fail the whole search; the valid rows in the same batch survive).
 */
fun mapUserSearchRows(
    rows: List<Map<String, Any?>>,
    currentUserId: String,
): List<User> =
    rows.mapNotNull { row ->
        // The Firestore doc id (== uniqueId string) is the User.uid.
        val uid = (row["uniqueId"] as? Number)?.toLong()?.toString() ?: return@mapNotNull null
        if (uid == currentUserId) return@mapNotNull null
        try {
            User.fromMap(row, uid)
        } catch (e: Exception) {
            null
        }
    }

/**
 * Flatten a single user JSON object from the search response into the
 * `Map<String, Any?>` shape [User.fromMap] expects. Primitives are coerced to
 * String / Long / Double / Boolean; nested objects/arrays are skipped (the
 * search payload's user-card fields — displayName, uniqueId, photo, nationality
 * — are all primitives, and [User.fromMap] tolerates the absent collection
 * fields via its defaults).
 *
 * In commonMain (not iosMain) so the flattener is covered on BOTH targets in
 * `commonTest`; `kotlinx.serialization.json` is multiplatform. Android uses its
 * own `org.json.JSONObject.toMap()` (org.json isn't multiplatform), so this is
 * the iOS-side equivalent — kept here for shared test coverage + parity.
 */
fun jsonObjectToMap(json: JsonObject): Map<String, Any?> =
    json.entries
        .mapNotNull { (key, value) ->
            val primitive = value as? JsonPrimitive ?: return@mapNotNull null
            val coerced: Any? =
                when {
                    primitive is JsonNull -> null
                    primitive.isString -> primitive.content
                    primitive.content == "true" || primitive.content == "false" -> primitive.content.toBoolean()
                    primitive.content.contains('.') -> primitive.content.toDoubleOrNull()
                    else -> primitive.content.toLongOrNull() ?: primitive.content
                }
            key to coerced
        }.toMap()
