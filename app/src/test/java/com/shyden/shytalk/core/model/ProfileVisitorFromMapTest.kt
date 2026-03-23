package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Date

class ProfileVisitorFromMapTest {
    private val tsMillis = 1_000_000_000L
    private val ts = Timestamp(Date(tsMillis))

    @Test
    fun `fromMap parses complete valid map`() {
        val map =
            mapOf<String, Any?>(
                "visitorId" to "visitor-1",
                "visitCount" to 5L,
                "lastVisitedAt" to ts,
                "firstVisitedAt" to ts,
            )
        val visitor = ProfileVisitor.fromMap(map)
        assertEquals("visitor-1", visitor.visitorId)
        assertEquals(5L, visitor.visitCount)
        assertEquals(tsMillis, visitor.lastVisitedAt)
        assertEquals(tsMillis, visitor.firstVisitedAt)
    }

    @Test
    fun `fromMap handles empty map with all defaults`() {
        val visitor = ProfileVisitor.fromMap(emptyMap())
        assertEquals("", visitor.visitorId)
        assertEquals(0L, visitor.visitCount)
    }

    @Test
    fun `fromMap defaults visitCount to 0 when missing`() {
        val map = mapOf<String, Any?>("visitorId" to "v1")
        val visitor = ProfileVisitor.fromMap(map)
        assertEquals(0L, visitor.visitCount)
    }

    @Test
    fun `fromMap defaults visitorId to empty when missing`() {
        val visitor = ProfileVisitor.fromMap(emptyMap())
        assertEquals("", visitor.visitorId)
    }

    @Test
    fun `toMap produces correct map`() {
        val visitor =
            ProfileVisitor(
                visitorId = "visitor-1",
                visitCount = 3,
                lastVisitedAt = tsMillis,
                firstVisitedAt = tsMillis,
            )
        val map = visitor.toMap()
        assertEquals("visitor-1", map["visitorId"])
        assertEquals(3L, map["visitCount"])
        assertEquals(tsMillis, map["lastVisitedAt"])
        assertEquals(tsMillis, map["firstVisitedAt"])
    }

    @Test
    fun `toMap contains exactly 4 keys`() {
        val visitor = ProfileVisitor()
        val map = visitor.toMap()
        assertEquals(4, map.size)
    }

    @Test
    fun `toMap keys match expected field names`() {
        val expectedKeys = setOf("visitorId", "visitCount", "lastVisitedAt", "firstVisitedAt")
        val visitor = ProfileVisitor()
        assertEquals(expectedKeys, visitor.toMap().keys)
    }

    @Test
    fun `fromMap of toMap produces equivalent visitor`() {
        val original =
            ProfileVisitor(
                visitorId = "visitor-1",
                visitCount = 7,
                lastVisitedAt = tsMillis,
                firstVisitedAt = tsMillis,
            )
        val roundtripped = ProfileVisitor.fromMap(original.toMap())
        assertEquals(original, roundtripped)
    }

    @Test
    fun `default constructor has expected defaults`() {
        val visitor = ProfileVisitor()
        assertEquals("", visitor.visitorId)
        assertEquals(0L, visitor.visitCount)
        assertEquals(0L, visitor.lastVisitedAt)
        assertEquals(0L, visitor.firstVisitedAt)
    }
}
