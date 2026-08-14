package com.shyden.shytalk.core

import kotlin.test.AfterTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Runtime QA-context slots feeding the preview watermark (SHY-0205).
 *
 * Deliberately SEPARATE from [BuildVariant]: BuildVariant's contract is
 * "set once at boot, immutable snapshot"; these slots are runtime-mutable
 * by design (journey markers come and go, routes change, health reports
 * stream in), so giving them their own holder keeps BuildVariant's
 * immutability promise intact.
 */
class QaContextTest {
    @AfterTest
    fun resetState() {
        QaContext.reset()
    }

    // ── defaults ──

    @Test
    fun `all slots default to unknown`() {
        assertNull(QaContext.journeyMarker)
        assertNull(QaContext.currentRoute)
        assertNull(QaContext.serverSha)
        assertNull(QaContext.serverOk)
    }

    // ── journey marker ──

    @Test
    fun `journey marker set and cleared`() {
        QaContext.setJourneyMarker("j01 s03")
        assertEquals("j01 s03", QaContext.journeyMarker)
        QaContext.setJourneyMarker(null)
        assertNull(QaContext.journeyMarker)
    }

    @Test
    fun `blank journey marker coerces to null`() {
        QaContext.setJourneyMarker("   ")
        assertNull(QaContext.journeyMarker)
    }

    // ── route ──

    @Test
    fun `route set and cleared with blank coercion`() {
        QaContext.setCurrentRoute("rooms/{roomId}")
        assertEquals("rooms/{roomId}", QaContext.currentRoute)
        QaContext.setCurrentRoute("")
        assertNull(QaContext.currentRoute)
    }

    // ── server health ──

    @Test
    fun `health report stores sha and ok state`() {
        QaContext.reportServerHealth(sha = "abc1234", ok = true)
        assertEquals("abc1234", QaContext.serverSha)
        assertEquals(true, QaContext.serverOk)
    }

    @Test
    fun `failed report retains last known sha`() {
        QaContext.reportServerHealth(sha = "abc1234", ok = true)
        QaContext.reportServerHealth(sha = null, ok = false)
        assertEquals("abc1234", QaContext.serverSha)
        assertEquals(false, QaContext.serverOk)
    }

    @Test
    fun `blank sha coerces to null without erasing last known`() {
        QaContext.reportServerHealth(sha = "abc1234", ok = true)
        QaContext.reportServerHealth(sha = "  ", ok = false)
        assertEquals("abc1234", QaContext.serverSha)
    }

    @Test
    fun `sha updates when a fresh value arrives`() {
        QaContext.reportServerHealth(sha = "abc1234", ok = true)
        QaContext.reportServerHealth(sha = "def5678", ok = true)
        assertEquals("def5678", QaContext.serverSha)
    }

    @Test
    fun `ok state transitions are visible`() {
        QaContext.reportServerHealth(sha = "abc1234", ok = true)
        assertTrue(QaContext.serverOk == true)
        QaContext.reportServerHealth(sha = "abc1234", ok = false)
        assertFalse(QaContext.serverOk == true)
    }

    // ── reset ──

    @Test
    fun `reset returns every slot to unknown`() {
        QaContext.setJourneyMarker("j01")
        QaContext.setCurrentRoute("main")
        QaContext.reportServerHealth(sha = "abc", ok = true)
        QaContext.reset()
        assertNull(QaContext.journeyMarker)
        assertNull(QaContext.currentRoute)
        assertNull(QaContext.serverSha)
        assertNull(QaContext.serverOk)
    }
}
