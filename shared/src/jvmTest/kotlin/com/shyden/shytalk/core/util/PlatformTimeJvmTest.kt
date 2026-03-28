package com.shyden.shytalk.core.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class PlatformTimeJvmTest {
    // ── currentTimeMillis ───────────────────────────────────────────

    @Test
    fun `currentTimeMillis returns positive value`() {
        assertTrue(currentTimeMillis() > 0)
    }

    @Test
    fun `currentTimeMillis returns increasing values`() {
        val first = currentTimeMillis()
        val second = currentTimeMillis()
        assertTrue(second >= first, "Second call should be >= first: $first vs $second")
    }

    @Test
    fun `currentTimeMillis matches System_currentTimeMillis roughly`() {
        val platform = currentTimeMillis()
        val system = System.currentTimeMillis()
        val diff = kotlin.math.abs(platform - system)
        assertTrue(diff < 1000, "Platform and System time differ by $diff ms")
    }

    // ── timestampToMillis ───────────────────────────────────────────

    @Test
    fun `timestampToMillis returns Long value directly`() {
        val millis = 1705326600000L
        assertEquals(millis, timestampToMillis(millis))
    }

    @Test
    fun `timestampToMillis converts Int to Long`() {
        val intValue: Any = 12345
        assertEquals(12345L, timestampToMillis(intValue))
    }

    @Test
    fun `timestampToMillis converts Double to Long`() {
        val doubleValue: Any = 1705326600000.0
        assertEquals(1705326600000L, timestampToMillis(doubleValue))
    }

    @Test
    fun `timestampToMillis converts Float to Long`() {
        val floatValue: Any = 12345.0f
        assertEquals(12345L, timestampToMillis(floatValue))
    }

    @Test
    fun `timestampToMillis returns currentTimeMillis for null`() {
        val before = currentTimeMillis()
        val result = timestampToMillis(null)
        val after = currentTimeMillis()
        assertTrue(result in before..after, "Expected result between $before and $after, got $result")
    }

    @Test
    fun `timestampToMillis returns currentTimeMillis for unrecognized type`() {
        val before = currentTimeMillis()
        val result = timestampToMillis("not a number")
        val after = currentTimeMillis()
        assertTrue(result in before..after, "Expected result between $before and $after, got $result")
    }

    @Test
    fun `timestampToMillis returns currentTimeMillis for list`() {
        val before = currentTimeMillis()
        val result = timestampToMillis(listOf(1, 2, 3))
        val after = currentTimeMillis()
        assertTrue(result in before..after)
    }

    @Test
    fun `timestampToMillis handles zero`() {
        assertEquals(0L, timestampToMillis(0L))
    }

    @Test
    fun `timestampToMillis handles negative Long`() {
        assertEquals(-1000L, timestampToMillis(-1000L))
    }

    // ── millisToTimestamp ────────────────────────────────────────────

    @Test
    fun `millisToTimestamp returns the Long value on JVM`() {
        val millis = 1705326600000L
        assertEquals(millis, millisToTimestamp(millis))
    }

    @Test
    fun `millisToTimestamp handles zero`() {
        assertEquals(0L, millisToTimestamp(0L))
    }

    // ── nowTimestamp ─────────────────────────────────────────────────

    @Test
    fun `nowTimestamp returns current time on JVM`() {
        val before = currentTimeMillis()
        val now = nowTimestamp() as Long
        val after = currentTimeMillis()
        assertTrue(now in before..after)
    }
}
