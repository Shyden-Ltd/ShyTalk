package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals

class ProfileVisitorTest {
    // ── fromMap ─────────────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "visitorId" to "visitor-1",
                "visitCount" to 5L,
                "lastVisitedAt" to 1705326600000L,
                "firstVisitedAt" to 1705000000000L,
            )

        val visitor = ProfileVisitor.fromMap(map)

        assertEquals("visitor-1", visitor.visitorId)
        assertEquals(5L, visitor.visitCount)
        assertEquals(1705326600000L, visitor.lastVisitedAt)
        assertEquals(1705000000000L, visitor.firstVisitedAt)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val visitor = ProfileVisitor.fromMap(emptyMap())

        assertEquals("", visitor.visitorId)
        assertEquals(0L, visitor.visitCount)
    }

    @Test
    fun `fromMap handles missing visitorId`() {
        val map = mapOf<String, Any?>("visitCount" to 3L)
        val visitor = ProfileVisitor.fromMap(map)
        assertEquals("", visitor.visitorId)
    }

    @Test
    fun `fromMap handles missing visitCount`() {
        val map = mapOf<String, Any?>("visitorId" to "v1")
        val visitor = ProfileVisitor.fromMap(map)
        assertEquals(0L, visitor.visitCount)
    }

    // ── toMap ────────────────────────────────────────────────────────

    @Test
    fun `toMap includes all fields`() {
        val visitor =
            ProfileVisitor(
                visitorId = "v1",
                visitCount = 10,
                lastVisitedAt = 1705326600000L,
                firstVisitedAt = 1705000000000L,
            )

        val map = visitor.toMap()

        assertEquals("v1", map["visitorId"])
        assertEquals(10L, map["visitCount"])
        assertEquals(1705326600000L, map["lastVisitedAt"])
        assertEquals(1705000000000L, map["firstVisitedAt"])
    }

    // ── roundtrip ───────────────────────────────────────────────────

    @Test
    fun `toMap and fromMap roundtrip preserves data`() {
        val original =
            ProfileVisitor(
                visitorId = "v-rt",
                visitCount = 7,
                lastVisitedAt = 1705326600000L,
                firstVisitedAt = 1705000000000L,
            )

        val map = original.toMap()
        val restored = ProfileVisitor.fromMap(map)

        assertEquals(original, restored)
    }
}
