package com.shyden.shytalk.data.repository

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Lock down the `GET /api/reports` JSON contract on the iOS-shared parser.
 * The two cases below regression-test the bugs the parser had before:
 *
 *  1. `type` was returned verbatim from the JSON — admin filters
 *     compare case-insensitively, so the iOS list lost matches against
 *     the Android-produced lowercase variants. Now lower-cased here.
 *  2. `timestamp` was read from the `timestamp` JSON key, but the
 *     Express endpoint emits `createdAt` (see `reports.js:202`). The
 *     iOS list always saw `0L` and the chronological sort silently
 *     broke. Now reads from `createdAt`.
 */
class ReportJsonParserTest {
    private val json = Json { ignoreUnknownKeys = true }

    @Test
    fun `type is lower-cased to match Android admin filter parity`() {
        val obj =
            json.parseToJsonElement(
                """{"id":"r1","type":"Sexual","createdAt":1700000000}""",
            ) as JsonObject
        val report = parseReportFromApi(obj)
        assertEquals("sexual", report.type)
    }

    @Test
    fun `timestamp is read from createdAt JSON key not legacy timestamp`() {
        val obj =
            json.parseToJsonElement(
                """{"id":"r1","createdAt":1700000000,"timestamp":42}""",
            ) as JsonObject
        val report = parseReportFromApi(obj)
        // Must be createdAt's value, NOT timestamp's 42.
        assertEquals(1700000000L, report.timestamp)
    }

    @Test
    fun `missing optional string fields default to empty string`() {
        val obj =
            json.parseToJsonElement(
                """{"id":"r1"}""",
            ) as JsonObject
        val report = parseReportFromApi(obj)
        assertEquals("", report.reporterId)
        assertEquals("", report.reportedUserName)
        assertEquals("", report.reason)
        assertEquals("", report.description)
        assertEquals("", report.type)
        assertEquals("", report.messageText)
    }

    @Test
    fun `missing status defaults to pending`() {
        val obj = json.parseToJsonElement("""{"id":"r1"}""") as JsonObject
        val report = parseReportFromApi(obj)
        assertEquals("pending", report.status)
    }

    @Test
    fun `missing numeric fields default to zero`() {
        val obj = json.parseToJsonElement("""{"id":"r1"}""") as JsonObject
        val report = parseReportFromApi(obj)
        assertEquals(0L, report.reporterUniqueId)
        assertEquals(0L, report.reportedUserUniqueId)
        assertEquals(0L, report.timestamp)
    }

    // ─── parseResolveReportOutcome — partial-failure contract ───
    //
    // The Express POST /reports/:id/resolve handler emits per-sub-action failure
    // flags so the admin client can distinguish "everything applied" from
    // "warning failed, the user was NOT warned, please retry" (see
    // express-api/src/routes/reports.js MOD_ERROR + memory
    // feedback-partial-failure-contracts.md). These tests pin the on-wire
    // shape so the Kotlin client never silently regresses to a green-toast
    // for a partial-failure response.

    @Test
    fun `resolve outcome — happy path has no failure flags`() {
        val obj = json.parseToJsonElement("""{"success":true}""") as JsonObject
        val outcome = parseResolveReportOutcome(obj)
        assertNull(outcome.warning)
        assertNull(outcome.suspension)
        assertNull(outcome.auditLog)
        assertNull(outcome.lockRelease)
        assertNull(outcome.cascade)
        assertNull(outcome.pms)
        assertFalse(outcome.hasAnyFailure)
    }

    @Test
    fun `resolve outcome — warning failure carries server error token`() {
        val obj =
            json.parseToJsonElement(
                """{"success":true,"warning":{"failed":true,"error":"warning_create_failed"}}""",
            ) as JsonObject
        val outcome = parseResolveReportOutcome(obj)
        val warning = outcome.warning
        assertNotNull(warning)
        assertEquals("warning_create_failed", warning.error)
        assertTrue(outcome.hasAnyFailure)
    }

    @Test
    fun `resolve outcome — suspension failure carries server error token`() {
        val obj =
            json.parseToJsonElement(
                """{"success":true,"suspension":{"failed":true,"error":"suspension_update_failed"}}""",
            ) as JsonObject
        val outcome = parseResolveReportOutcome(obj)
        val suspension = outcome.suspension
        assertNotNull(suspension)
        assertEquals("suspension_update_failed", suspension.error)
        assertTrue(outcome.hasAnyFailure)
    }

    @Test
    fun `resolve outcome — auditLog failure carries server error token`() {
        val obj =
            json.parseToJsonElement(
                """{"success":true,"auditLog":{"failed":true,"error":"audit_write_failed"}}""",
            ) as JsonObject
        val outcome = parseResolveReportOutcome(obj)
        val auditLog = outcome.auditLog
        assertNotNull(auditLog)
        assertEquals("audit_write_failed", auditLog.error)
        assertTrue(outcome.hasAnyFailure)
    }

    @Test
    fun `resolve outcome — lockRelease failure has no error token but is surfaced`() {
        // The server emits {failed:true} only — lockRelease has no MOD_ERROR
        // token because the admin doesn't need to distinguish lock-write
        // causes; just retrying clears it.
        val obj =
            json.parseToJsonElement(
                """{"success":true,"lockRelease":{"failed":true}}""",
            ) as JsonObject
        val outcome = parseResolveReportOutcome(obj)
        val lockRelease = outcome.lockRelease
        assertNotNull(lockRelease)
        assertNull(lockRelease.error)
        assertTrue(outcome.hasAnyFailure)
    }

    @Test
    fun `resolve outcome — cascade success surfaces counts but no failure`() {
        val obj =
            json.parseToJsonElement(
                """{"success":true,"cascade":{"roomsClosed":2,"roomsUpdated":3,"partial":false,"failedRoomIds":[],"userDocFailed":false,"rtdbEventsFailed":0,"error":null}}""",
            ) as JsonObject
        val outcome = parseResolveReportOutcome(obj)
        val cascade = outcome.cascade
        assertNotNull(cascade)
        assertEquals(2, cascade.roomsClosed)
        assertEquals(3, cascade.roomsUpdated)
        assertFalse(cascade.partial)
        assertNull(cascade.error)
        // cascade.partial=false ⇒ cascade does NOT count as a failure.
        assertFalse(outcome.hasAnyFailure)
    }

    @Test
    fun `resolve outcome — cascade partial surfaces failed room ids`() {
        val obj =
            json.parseToJsonElement(
                """{"success":true,"cascade":{"roomsClosed":1,"roomsUpdated":0,"partial":true,"failedRoomIds":["room-a","room-b"],"userDocFailed":true,"rtdbEventsFailed":2,"error":"cascade_failed"}}""",
            ) as JsonObject
        val outcome = parseResolveReportOutcome(obj)
        val cascade = outcome.cascade
        assertNotNull(cascade)
        assertTrue(cascade.partial)
        assertEquals(listOf("room-a", "room-b"), cascade.failedRoomIds)
        assertTrue(cascade.userDocFailed)
        assertEquals(2, cascade.rtdbEventsFailed)
        assertEquals("cascade_failed", cascade.error)
        assertTrue(outcome.hasAnyFailure)
    }

    @Test
    fun `resolve outcome — pms surfaces failed-of-total counters`() {
        val obj =
            json.parseToJsonElement(
                """{"success":true,"pms":{"failed":2,"total":3}}""",
            ) as JsonObject
        val outcome = parseResolveReportOutcome(obj)
        val pms = outcome.pms
        assertNotNull(pms)
        assertEquals(2, pms.failed)
        assertEquals(3, pms.total)
        assertTrue(outcome.hasAnyFailure)
    }

    @Test
    fun `resolve outcome — multiple failures surface independently`() {
        // Pathological worst case: warn + suspend both threw, audit failed,
        // lock-release failed, cascade is partial, both user-target and
        // reporter PMs failed. The admin needs to see every flag so they
        // can decide which sub-action to retry first.
        val obj =
            json.parseToJsonElement(
                """{"success":true,
                  "warning":{"failed":true,"error":"warning_create_failed"},
                  "suspension":{"failed":true,"error":"suspension_update_failed"},
                  "auditLog":{"failed":true,"error":"audit_write_failed"},
                  "lockRelease":{"failed":true},
                  "cascade":{"roomsClosed":0,"roomsUpdated":0,"partial":true,"failedRoomIds":["x"],"userDocFailed":true,"rtdbEventsFailed":1,"error":"cascade_failed"},
                  "pms":{"failed":2,"total":2}}""",
            ) as JsonObject
        val outcome = parseResolveReportOutcome(obj)
        assertNotNull(outcome.warning)
        assertNotNull(outcome.suspension)
        assertNotNull(outcome.auditLog)
        assertNotNull(outcome.lockRelease)
        assertNotNull(outcome.cascade)
        assertNotNull(outcome.pms)
        assertTrue(outcome.hasAnyFailure)
    }

    @Test
    fun `resolve outcome — failed flag false is treated as no failure`() {
        // Defensive: the server should never emit `{failed:false}` (a missing
        // sub-key signals success), but if a future regression starts emitting
        // an explicit false, the parser must NOT mis-flag it as a failure.
        val obj =
            json.parseToJsonElement(
                """{"success":true,"warning":{"failed":false}}""",
            ) as JsonObject
        val outcome = parseResolveReportOutcome(obj)
        assertNull(outcome.warning)
        assertFalse(outcome.hasAnyFailure)
    }

    @Test
    fun `resolve outcome — string overload parses JSON body identically`() {
        // The Android :app module passes JSONObject.toString(); the string
        // overload must yield the same outcome as parsing the JsonObject
        // directly so platform-divergent regressions are impossible.
        val raw = """{"success":true,"warning":{"failed":true,"error":"warning_create_failed"}}"""
        val outcome = parseResolveReportOutcome(raw)
        val warning = outcome.warning
        assertNotNull(warning)
        assertEquals("warning_create_failed", warning.error)
    }

    @Test
    fun `resolve outcome — string overload swallows malformed JSON`() {
        // Malformed JSON must NOT throw — the caller already wraps the
        // resolveReport call in firebaseCall, and turning a parse miss into
        // a Resource.Error would tell the admin the moderation didn't
        // apply (it did, the report row was already updated server-side).
        val outcome = parseResolveReportOutcome("not valid json {")
        assertFalse(outcome.hasAnyFailure)
        assertNull(outcome.warning)
    }

    @Test
    fun `resolve outcome — string overload of non-object JSON returns empty outcome`() {
        // Defensive: if the server ever returns a JSON array or scalar
        // (it shouldn't — but a future bug could), don't crash the admin.
        val outcome = parseResolveReportOutcome("[1, 2, 3]")
        assertFalse(outcome.hasAnyFailure)
    }

    @Test
    fun `resolve outcome — unknown extra keys on body are ignored`() {
        // Forward compatibility: a future server-side flag (e.g. `cooldown`)
        // must not crash older clients. Parser must read only known keys.
        val obj =
            json.parseToJsonElement(
                """{"success":true,"cooldown":{"failed":true,"error":"cooldown_failed"},"warning":{"failed":true,"error":"warning_create_failed"}}""",
            ) as JsonObject
        val outcome = parseResolveReportOutcome(obj)
        assertNotNull(outcome.warning)
        // No surprise mapping of unknown keys onto known fields.
        assertNull(outcome.suspension)
        assertNull(outcome.auditLog)
    }
}
