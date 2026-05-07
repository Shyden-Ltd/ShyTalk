package com.shyden.shytalk.data.repository

import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlin.test.Test
import kotlin.test.assertEquals

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
}
