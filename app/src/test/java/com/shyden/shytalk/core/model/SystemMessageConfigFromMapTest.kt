package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class SystemMessageConfigFromMapTest {
    @Test
    fun `default values are all true`() {
        val config = SystemMessageConfig()
        assertTrue(config.showJoins)
        assertTrue(config.showLeaves)
        assertTrue(config.showRoleChanges)
        assertTrue(config.showPermissionChanges)
    }

    @Test
    fun `fromMap parses complete valid map`() {
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
    fun `fromMap handles empty map with defaults`() {
        val config = SystemMessageConfig.fromMap(emptyMap())
        assertTrue(config.showJoins)
        assertTrue(config.showLeaves)
        assertTrue(config.showRoleChanges)
        assertTrue(config.showPermissionChanges)
    }

    @Test
    fun `fromMap handles null values with defaults`() {
        val map =
            mapOf<String, Any?>(
                "showJoins" to null,
                "showLeaves" to null,
                "showRoleChanges" to null,
                "showPermissionChanges" to null,
            )
        val config = SystemMessageConfig.fromMap(map)
        assertTrue(config.showJoins)
        assertTrue(config.showLeaves)
        assertTrue(config.showRoleChanges)
        assertTrue(config.showPermissionChanges)
    }

    @Test
    fun `fromMap handles non-boolean values with defaults`() {
        val map =
            mapOf<String, Any?>(
                "showJoins" to "true",
                "showLeaves" to 1,
                "showRoleChanges" to listOf(true),
                "showPermissionChanges" to mapOf("val" to true),
            )
        val config = SystemMessageConfig.fromMap(map)
        assertTrue(config.showJoins)
        assertTrue(config.showLeaves)
        assertTrue(config.showRoleChanges)
        assertTrue(config.showPermissionChanges)
    }

    @Test
    fun `fromMap parses all false`() {
        val map =
            mapOf<String, Any?>(
                "showJoins" to false,
                "showLeaves" to false,
                "showRoleChanges" to false,
                "showPermissionChanges" to false,
            )
        val config = SystemMessageConfig.fromMap(map)
        assertFalse(config.showJoins)
        assertFalse(config.showLeaves)
        assertFalse(config.showRoleChanges)
        assertFalse(config.showPermissionChanges)
    }

    @Test
    fun `toMap serializes all fields`() {
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

    @Test
    fun `fromMap of toMap round-trip`() {
        val original =
            SystemMessageConfig(
                showJoins = false,
                showLeaves = true,
                showRoleChanges = false,
                showPermissionChanges = true,
            )
        val roundtripped = SystemMessageConfig.fromMap(original.toMap())
        assertEquals(original, roundtripped)
    }

    @Test
    fun `fromMap of toMap round-trip with defaults`() {
        val original = SystemMessageConfig()
        val roundtripped = SystemMessageConfig.fromMap(original.toMap())
        assertEquals(original, roundtripped)
    }

    @Test
    fun `fromMap handles missing fields individually`() {
        val mapOnlyJoins = mapOf<String, Any?>("showJoins" to false)
        val config = SystemMessageConfig.fromMap(mapOnlyJoins)
        assertFalse(config.showJoins)
        assertTrue(config.showLeaves)
        assertTrue(config.showRoleChanges)
        assertTrue(config.showPermissionChanges)
    }
}
