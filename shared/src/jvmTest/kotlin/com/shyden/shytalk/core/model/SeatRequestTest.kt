package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class SeatRequestTest {
    // ── fromMap ─────────────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "requestId" to "req-1",
                "userId" to "user-1",
                "userName" to "Alice",
                "seatIndex" to 3,
                "status" to "PENDING",
                "createdAt" to 1705326600000L,
                "resolvedBy" to "owner-1",
                "resolvedAt" to 1705326700000L,
            )

        val request = SeatRequest.fromMap(map, "req-1")

        assertEquals("req-1", request.requestId)
        assertEquals("user-1", request.userId)
        assertEquals("Alice", request.userName)
        assertEquals(3, request.seatIndex)
        assertEquals(SeatRequestStatus.PENDING, request.status)
        assertEquals(1705326600000L, request.createdAt)
        assertEquals("owner-1", request.resolvedBy)
        assertEquals(1705326700000L, request.resolvedAt)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val request = SeatRequest.fromMap(emptyMap(), "req-2")

        assertEquals("req-2", request.requestId)
        assertEquals("", request.userId)
        assertEquals("", request.userName)
        assertEquals(-1, request.seatIndex)
        assertEquals(SeatRequestStatus.PENDING, request.status)
        assertNull(request.resolvedBy)
        assertNull(request.resolvedAt)
    }

    @Test
    fun `fromMap parses APPROVED status`() {
        val map = mapOf<String, Any?>("status" to "APPROVED")
        val request = SeatRequest.fromMap(map, "req-3")
        assertEquals(SeatRequestStatus.APPROVED, request.status)
    }

    @Test
    fun `fromMap parses DENIED status`() {
        val map = mapOf<String, Any?>("status" to "DENIED")
        val request = SeatRequest.fromMap(map, "req-4")
        assertEquals(SeatRequestStatus.DENIED, request.status)
    }

    @Test
    fun `fromMap defaults to PENDING for unknown status`() {
        val map = mapOf<String, Any?>("status" to "INVALID")
        val request = SeatRequest.fromMap(map, "req-5")
        assertEquals(SeatRequestStatus.PENDING, request.status)
    }

    @Test
    fun `fromMap handles Number type for seatIndex`() {
        val map = mapOf<String, Any?>("seatIndex" to 5L)
        val request = SeatRequest.fromMap(map, "req-6")
        assertEquals(5, request.seatIndex)
    }

    // ── toMap ────────────────────────────────────────────────────────

    @Test
    fun `toMap includes all fields`() {
        val request =
            SeatRequest(
                requestId = "req-1",
                userId = "user-1",
                userName = "Alice",
                seatIndex = 3,
                status = SeatRequestStatus.APPROVED,
                createdAt = 1705326600000L,
                resolvedBy = "owner-1",
                resolvedAt = 1705326700000L,
            )

        val map = request.toMap()

        assertEquals("req-1", map["requestId"])
        assertEquals("user-1", map["userId"])
        assertEquals("Alice", map["userName"])
        assertEquals(3, map["seatIndex"])
        assertEquals("APPROVED", map["status"])
        assertEquals(1705326600000L, map["createdAt"])
        assertEquals("owner-1", map["resolvedBy"])
        assertEquals(1705326700000L, map["resolvedAt"])
    }

    @Test
    fun `toMap includes null resolvedBy and resolvedAt`() {
        val request = SeatRequest(resolvedBy = null, resolvedAt = null)
        val map = request.toMap()
        assertNull(map["resolvedBy"])
        assertNull(map["resolvedAt"])
    }

    // ── roundtrip ───────────────────────────────────────────────────

    @Test
    fun `toMap and fromMap roundtrip preserves data`() {
        val original =
            SeatRequest(
                requestId = "req-rt",
                userId = "user-1",
                userName = "Bob",
                seatIndex = 5,
                status = SeatRequestStatus.DENIED,
                createdAt = 1705326600000L,
                resolvedBy = "owner-1",
                resolvedAt = 1705326700000L,
            )

        val map = original.toMap()
        val restored = SeatRequest.fromMap(map, original.requestId)

        assertEquals(original, restored)
    }

    @Test
    fun `roundtrip with PENDING status and no resolver`() {
        val original =
            SeatRequest(
                requestId = "req-pending",
                userId = "u1",
                userName = "User",
                seatIndex = 2,
                status = SeatRequestStatus.PENDING,
                createdAt = 1705326600000L,
                resolvedBy = null,
                resolvedAt = null,
            )

        val restored = SeatRequest.fromMap(original.toMap(), original.requestId)
        assertEquals(original, restored)
    }

    // ── SeatRequestStatus enum ──────────────────────────────────────

    @Test
    fun `SeatRequestStatus has expected values`() {
        val statuses = SeatRequestStatus.entries
        assertEquals(3, statuses.size)
        assertTrue(SeatRequestStatus.PENDING in statuses)
        assertTrue(SeatRequestStatus.APPROVED in statuses)
        assertTrue(SeatRequestStatus.DENIED in statuses)
    }
}
