package com.shyden.shytalk.data.repository

import com.shyden.shytalk.feature.messaging.Report
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.booleanOrNull
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonPrimitive
import kotlinx.serialization.json.longOrNull

private val resolveReportJson = Json { ignoreUnknownKeys = true }

/**
 * Parses a single report JSON object as emitted by `GET /api/reports`
 * (Express route at `express-api/src/routes/reports.js`). Lives in
 * commonMain so the iOS-side parser stays in sync with what the admin
 * web client expects — the previous bespoke iOS parsing diverged from
 * Android (wrong JSON key for the timestamp; missing `.lowercase()` on
 * the `type` field that admin filters compare case-insensitively).
 */
internal fun parseReportFromApi(obj: JsonObject): Report =
    Report(
        reportId = obj["id"]?.jsonPrimitive?.contentOrNull ?: "",
        reporterId = obj["reporterId"]?.jsonPrimitive?.contentOrNull ?: "",
        reporterName = obj["reporterName"]?.jsonPrimitive?.contentOrNull ?: "",
        reporterUniqueId = obj["reporterUniqueId"]?.jsonPrimitive?.longOrNull ?: 0L,
        reportedUserId = obj["reportedUserId"]?.jsonPrimitive?.contentOrNull ?: "",
        reportedUserName = obj["reportedUserName"]?.jsonPrimitive?.contentOrNull ?: "",
        reportedUserUniqueId = obj["reportedUserUniqueId"]?.jsonPrimitive?.longOrNull ?: 0L,
        conversationId = obj["conversationId"]?.jsonPrimitive?.contentOrNull ?: "",
        messageId = obj["messageId"]?.jsonPrimitive?.contentOrNull ?: "",
        messageText = obj["messageText"]?.jsonPrimitive?.contentOrNull ?: "",
        reason = obj["reason"]?.jsonPrimitive?.contentOrNull ?: "",
        description = obj["description"]?.jsonPrimitive?.contentOrNull ?: "",
        type = (obj["type"]?.jsonPrimitive?.contentOrNull ?: "").lowercase(),
        timestamp = obj["createdAt"]?.jsonPrimitive?.longOrNull ?: 0L,
        status = obj["status"]?.jsonPrimitive?.contentOrNull ?: "pending",
    )

/**
 * Per-sub-action failure surfaced from the moderation partial-failure
 * contract (see `express-api/src/routes/reports.js` MOD_ERROR + memory
 * `feedback-partial-failure-contracts.md`). A non-null instance ALWAYS
 * means the sub-action did NOT land server-side. `error` carries the
 * stable token (`warning_create_failed`, `suspension_update_failed`,
 * `audit_write_failed`) so the admin client can branch on the cause;
 * `lockRelease` emits no token because the only retry strategy is
 * "send the resolve again".
 */
data class SubFailure(
    val error: String?,
)

/**
 * Cascade outcome from `evictSuspendedUser` — surfaced ONLY when the
 * resolve action is "suspended" and the cascade ran. `partial=true`
 * means at least one room or the user-doc update failed and the admin
 * UI should warn about manual cleanup; `partial=false` is the success
 * shape and is informational only (`hasAnyFailure` ignores it).
 */
data class CascadeOutcome(
    val roomsClosed: Int = 0,
    val roomsUpdated: Int = 0,
    val partial: Boolean = false,
    val failedRoomIds: List<String> = emptyList(),
    val userDocFailed: Boolean = false,
    val rtdbEventsFailed: Int = 0,
    val error: String? = null,
)

/**
 * PM partial-failure counter. `failed` and `total` are summed across
 * the warn-PM, suspend-PM, and reporter-PM dispatch; the admin sees
 * "2 of 3 PMs failed" rather than three separate flags. Surfaced only
 * when at least one PM fails (matches the server's
 * `if (failedSinglePms > 0)` gate).
 */
data class PmFailure(
    val failed: Int,
    val total: Int,
)

/**
 * Outcome of `POST /api/reports/:id/resolve`. ANY non-null sub-failure
 * indicates a partial-success that the admin must see — the moderation
 * applied SOME side-effects but not all. Replaces the `Resource<Unit>`
 * shape that previously discarded the response body and silently green-
 * toasted partial failures (the very bug PR #355 Pass-9 surfaced for
 * the web client; this fix wires the same contract to the Kotlin
 * admin client).
 */
data class ResolveReportOutcome(
    val warning: SubFailure? = null,
    val suspension: SubFailure? = null,
    val auditLog: SubFailure? = null,
    val lockRelease: SubFailure? = null,
    val cascade: CascadeOutcome? = null,
    val pms: PmFailure? = null,
) {
    /**
     * True iff at least one sub-action failed. Cascade is folded in only
     * when `partial=true` — a clean cascade carries informational counters
     * but is NOT a failure.
     */
    val hasAnyFailure: Boolean
        get() =
            warning != null ||
                suspension != null ||
                auditLog != null ||
                lockRelease != null ||
                pms != null ||
                (cascade?.partial == true)
}

private fun parseSubFailure(obj: JsonObject?): SubFailure? {
    if (obj == null) return null
    val failed = obj["failed"]?.jsonPrimitive?.booleanOrNull ?: false
    if (!failed) return null
    return SubFailure(error = obj["error"]?.jsonPrimitive?.contentOrNull)
}

private fun parseCascade(obj: JsonObject?): CascadeOutcome? {
    if (obj == null) return null
    val failedRoomIds: List<String> =
        (obj["failedRoomIds"] as? JsonArray)?.mapNotNull {
            it.jsonPrimitive.contentOrNull
        } ?: emptyList()
    return CascadeOutcome(
        roomsClosed = obj["roomsClosed"]?.jsonPrimitive?.intOrNull ?: 0,
        roomsUpdated = obj["roomsUpdated"]?.jsonPrimitive?.intOrNull ?: 0,
        partial = obj["partial"]?.jsonPrimitive?.booleanOrNull ?: false,
        failedRoomIds = failedRoomIds,
        userDocFailed = obj["userDocFailed"]?.jsonPrimitive?.booleanOrNull ?: false,
        rtdbEventsFailed = obj["rtdbEventsFailed"]?.jsonPrimitive?.intOrNull ?: 0,
        error = obj["error"]?.jsonPrimitive?.contentOrNull,
    )
}

private fun parsePms(obj: JsonObject?): PmFailure? {
    if (obj == null) return null
    val failed = obj["failed"]?.jsonPrimitive?.intOrNull ?: 0
    val total = obj["total"]?.jsonPrimitive?.intOrNull ?: 0
    if (failed <= 0) return null
    return PmFailure(failed = failed, total = total)
}

/**
 * Parse a `POST /api/reports/:id/resolve` response body into the typed
 * partial-failure outcome. Forward-compatible: unknown top-level keys
 * are ignored. Symmetric with the server-side MOD_ERROR contract.
 */
fun parseResolveReportOutcome(obj: JsonObject): ResolveReportOutcome =
    ResolveReportOutcome(
        warning = parseSubFailure(obj["warning"] as? JsonObject),
        suspension = parseSubFailure(obj["suspension"] as? JsonObject),
        auditLog = parseSubFailure(obj["auditLog"] as? JsonObject),
        lockRelease = parseSubFailure(obj["lockRelease"] as? JsonObject),
        cascade = parseCascade(obj["cascade"] as? JsonObject),
        pms = parsePms(obj["pms"] as? JsonObject),
    )

/**
 * String overload for callers (notably the Android `:app` module) that
 * speak `org.json.JSONObject` and don't have kotlinx.serialization on
 * their classpath. The hop is `JSONObject.toString()` → parse here →
 * structured outcome — paid only on resolveReport, never on hot loops.
 * Returns an empty outcome on malformed JSON rather than throwing,
 * because the caller already wraps the call site in `firebaseCall` and
 * a parse failure on the success path should still surface as
 * "moderation applied" — the lost flags become visible in the next
 * pending-reports query (status=resolved + admin sees the wrong state).
 */
fun parseResolveReportOutcome(rawJson: String): ResolveReportOutcome =
    runCatching {
        resolveReportJson.parseToJsonElement(rawJson) as? JsonObject
    }.getOrNull()?.let(::parseResolveReportOutcome) ?: ResolveReportOutcome()
