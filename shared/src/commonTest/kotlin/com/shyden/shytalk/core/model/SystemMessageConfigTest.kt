package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class SystemMessageConfigTest {
    // ── fromMap ─────────────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "showJoins" to false,
                "showLeaves" to true,
                "showRoleChanges" to false,
                "showPermissionChanges" to true,
            )

        val config = SystemMessageConfig.fromMap(map)

        assertFalse(config.showJoins)
        assertTrue(config.showLeaves)
        assertFalse(config.showRoleChanges)
        assertTrue(config.showPermissionChanges)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val config = SystemMessageConfig.fromMap(emptyMap())

        assertTrue(config.showJoins)
        assertTrue(config.showLeaves)
        assertTrue(config.showRoleChanges)
        assertTrue(config.showPermissionChanges)
    }

    @Test
    fun `fromMap handles integer booleans`() {
        val map =
            mapOf<String, Any?>(
                "showJoins" to 0,
                "showLeaves" to 1,
                "showRoleChanges" to 0,
                "showPermissionChanges" to 1,
            )

        val config = SystemMessageConfig.fromMap(map)

        assertFalse(config.showJoins)
        assertTrue(config.showLeaves)
        assertFalse(config.showRoleChanges)
        assertTrue(config.showPermissionChanges)
    }

    @Test
    fun `fromMap defaults to true for null values`() {
        val map =
            mapOf<String, Any?>(
                "showJoins" to null,
                "showLeaves" to null,
            )

        val config = SystemMessageConfig.fromMap(map)

        assertTrue(config.showJoins)
        assertTrue(config.showLeaves)
    }

    // ── toMap ────────────────────────────────────────────────────────

    @Test
    fun `toMap includes all fields as booleans`() {
        val config =
            SystemMessageConfig(
                showJoins = false,
                showLeaves = true,
                showRoleChanges = false,
                showPermissionChanges = true,
            )

        val map = config.toMap()

        assertEquals(false, map["showJoins"])
        assertEquals(true, map["showLeaves"])
        assertEquals(false, map["showRoleChanges"])
        assertEquals(true, map["showPermissionChanges"])
    }

    // ── roundtrip ───────────────────────────────────────────────────

    @Test
    fun `toMap and fromMap roundtrip preserves data`() {
        val original =
            SystemMessageConfig(
                showJoins = false,
                showLeaves = false,
                showRoleChanges = true,
                showPermissionChanges = false,
            )

        val map = original.toMap()
        val restored = SystemMessageConfig.fromMap(map)

        assertEquals(original, restored)
    }

    @Test
    fun `roundtrip with all true`() {
        val original = SystemMessageConfig()
        val restored = SystemMessageConfig.fromMap(original.toMap())
        assertEquals(original, restored)
    }

    @Test
    fun `roundtrip with all false`() {
        val original =
            SystemMessageConfig(
                showJoins = false,
                showLeaves = false,
                showRoleChanges = false,
                showPermissionChanges = false,
            )
        val restored = SystemMessageConfig.fromMap(original.toMap())
        assertEquals(original, restored)
    }

    // ── Default constructor ─────────────────────────────────────────

    @Test
    fun `default constructor has all true`() {
        val config = SystemMessageConfig()
        assertTrue(config.showJoins)
        assertTrue(config.showLeaves)
        assertTrue(config.showRoleChanges)
        assertTrue(config.showPermissionChanges)
    }
}
