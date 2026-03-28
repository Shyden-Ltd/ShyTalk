package com.shyden.shytalk.core.util

import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class MapExtTest {
    // ── Boolean values ──────────────────────────────────────────────

    @Test
    fun `asBool returns true for Boolean true`() {
        val value: Any? = true
        assertTrue(value.asBool())
    }

    @Test
    fun `asBool returns false for Boolean false`() {
        val value: Any? = false
        assertFalse(value.asBool())
    }

    // ── Number values ───────────────────────────────────────────────

    @Test
    fun `asBool returns true for Int 1`() {
        val value: Any? = 1
        assertTrue(value.asBool())
    }

    @Test
    fun `asBool returns false for Int 0`() {
        val value: Any? = 0
        assertFalse(value.asBool())
    }

    @Test
    fun `asBool returns true for Long 1`() {
        val value: Any? = 1L
        assertTrue(value.asBool())
    }

    @Test
    fun `asBool returns false for Long 0`() {
        val value: Any? = 0L
        assertFalse(value.asBool())
    }

    @Test
    fun `asBool returns true for negative number`() {
        val value: Any? = -1
        assertTrue(value.asBool())
    }

    @Test
    fun `asBool returns true for large number`() {
        val value: Any? = 42
        assertTrue(value.asBool())
    }

    @Test
    fun `asBool returns true for Double 1_0`() {
        val value: Any? = 1.0
        assertTrue(value.asBool())
    }

    @Test
    fun `asBool returns false for Double 0_0`() {
        val value: Any? = 0.0
        assertFalse(value.asBool())
    }

    @Test
    fun `asBool returns true for Float 1_0f`() {
        val value: Any? = 1.0f
        assertTrue(value.asBool())
    }

    @Test
    fun `asBool returns false for Float 0_0f`() {
        val value: Any? = 0.0f
        assertFalse(value.asBool())
    }

    // ── Null and other types ────────────────────────────────────────

    @Test
    fun `asBool returns default false for null`() {
        val value: Any? = null
        assertFalse(value.asBool())
    }

    @Test
    fun `asBool returns custom default for null`() {
        val value: Any? = null
        assertTrue(value.asBool(default = true))
    }

    @Test
    fun `asBool returns default for String`() {
        val value: Any? = "true"
        assertFalse(value.asBool())
    }

    @Test
    fun `asBool returns custom default true for String`() {
        val value: Any? = "anything"
        assertTrue(value.asBool(default = true))
    }

    @Test
    fun `asBool returns default for list`() {
        val value: Any? = listOf(1, 2, 3)
        assertFalse(value.asBool())
    }

    @Test
    fun `asBool returns default for map`() {
        val value: Any? = mapOf("key" to "val")
        assertFalse(value.asBool())
    }

    // ── Default parameter ───────────────────────────────────────────

    @Test
    fun `asBool default parameter is false by default`() {
        val value: Any? = null
        assertFalse(value.asBool())
    }

    @Test
    fun `asBool with default true returns true for null`() {
        assertTrue(null.asBool(true))
    }

    @Test
    fun `asBool with default true returns true for unrecognized type`() {
        val value: Any? = object {}
        assertTrue(value.asBool(true))
    }

    @Test
    fun `asBool ignores default when value is Boolean`() {
        val value: Any? = false
        assertFalse(value.asBool(default = true))
    }

    @Test
    fun `asBool ignores default when value is Number`() {
        val value: Any? = 0
        assertFalse(value.asBool(default = true))
    }
}
