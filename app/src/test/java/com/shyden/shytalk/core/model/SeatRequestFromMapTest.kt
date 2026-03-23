package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.util.Date

class SeatRequestFromMapTest {
    private val tsMillis = 1_000_000_000L
    private val ts = Timestamp(Date(tsMillis))

    @Test
    fun `fromMap parses complete valid map`() {
        val map =
            mapOf<String, Any?>(
                "userId" to "user-1",
                "userName" to "Alice",
                "seatIndex" to 3L,
                "status" to "PENDING",
                "createdAt" to ts,
                "resolvedBy" to "admin",
                "resolvedAt" to ts,
            )
        val req = SeatRequest.fromMap(map, "req-1")
        assertEquals("req-1", req.requestId)
        assertEquals("user-1", req.userId)
        assertEquals("Alice", req.userName)
        assertEquals(3, req.seatIndex)
        assertEquals(SeatRequestStatus.PENDING, req.status)
        assertEquals(tsMillis, req.createdAt)
        assertEquals("admin", req.resolvedBy)
        assertEquals(tsMillis, req.resolvedAt)
    }

    @Test
    fun `fromMap converts Long seatIndex to Int`() {
        val map = mapOf<String, Any?>("seatIndex" to 5L)
        val req = SeatRequest.fromMap(map, "req-1")
        assertEquals(5, req.seatIndex)
    }

    @Test
    fun `fromMap defaults seatIndex to -1 when missing`() {
        val req = SeatRequest.fromMap(emptyMap(), "req-1")
        assertEquals(-1, req.seatIndex)
    }

    @Test
    fun `fromMap defaults status to PENDING for invalid value`() {
        val map = mapOf<String, Any?>("status" to "INVALID")
        val req = SeatRequest.fromMap(map, "req-1")
        assertEquals(SeatRequestStatus.PENDING, req.status)
    }

    @Test
    fun `fromMap parses APPROVED status`() {
        val map = mapOf<String, Any?>("status" to "APPROVED")
        val req = SeatRequest.fromMap(map, "req-1")
        assertEquals(SeatRequestStatus.APPROVED, req.status)
    }

    @Test
    fun `fromMap parses DENIED status`() {
        val map = mapOf<String, Any?>("status" to "DENIED")
        val req = SeatRequest.fromMap(map, "req-1")
        assertEquals(SeatRequestStatus.DENIED, req.status)
    }

    @Test
    fun `fromMap returns null for optional fields when missing`() {
        val req = SeatRequest.fromMap(emptyMap(), "req-1")
        assertNull(req.resolvedBy)
        assertNull(req.resolvedAt)
    }
}
