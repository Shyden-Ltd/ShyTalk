package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

class GroupPermissionsFromMapTest {
    @Test
    fun `default values for original fields are EVERYONE`() {
        val perms = GroupPermissions()
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanSend)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanAddMembers)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanEditInfo)
    }

    @Test
    fun `default values for new fields`() {
        val perms = GroupPermissions()
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanDeleteMessages)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanMuteMembers)
        assertEquals(GroupPermissions.PermissionLevel.ADMINS_ONLY, perms.whoCanRemoveMembers)
    }

    @Test
    fun `fromMap parses complete valid map`() {
        val map =
            mapOf<String, Any?>(
                "whoCanSend" to "MODS_AND_ABOVE",
                "whoCanAddMembers" to "MODS_AND_ABOVE",
                "whoCanEditInfo" to "EVERYONE",
                "whoCanDeleteMessages" to "ADMINS_ONLY",
                "whoCanMuteMembers" to "OWNER_ONLY",
                "whoCanRemoveMembers" to "MODS_AND_ABOVE",
            )
        val perms = GroupPermissions.fromMap(map)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanSend)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanAddMembers)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanEditInfo)
        assertEquals(GroupPermissions.PermissionLevel.ADMINS_ONLY, perms.whoCanDeleteMessages)
        assertEquals(GroupPermissions.PermissionLevel.OWNER_ONLY, perms.whoCanMuteMembers)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanRemoveMembers)
    }

    @Test
    fun `fromMap handles empty map with defaults`() {
        val perms = GroupPermissions.fromMap(emptyMap())
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanSend)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanAddMembers)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanEditInfo)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanDeleteMessages)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanMuteMembers)
        assertEquals(GroupPermissions.PermissionLevel.ADMINS_ONLY, perms.whoCanRemoveMembers)
    }

    @Test
    fun `fromMap falls back to defaults for invalid enum values`() {
        val map =
            mapOf<String, Any?>(
                "whoCanSend" to "INVALID_VALUE",
                "whoCanAddMembers" to "NONSENSE",
                "whoCanEditInfo" to "",
                "whoCanDeleteMessages" to "BAD",
                "whoCanMuteMembers" to "WRONG",
                "whoCanRemoveMembers" to "NOPE",
            )
        val perms = GroupPermissions.fromMap(map)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanSend)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanAddMembers)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanEditInfo)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanDeleteMessages)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanMuteMembers)
        assertEquals(GroupPermissions.PermissionLevel.ADMINS_ONLY, perms.whoCanRemoveMembers)
    }

    @Test
    fun `fromMap falls back to defaults for null values`() {
        val map =
            mapOf<String, Any?>(
                "whoCanSend" to null,
                "whoCanAddMembers" to null,
                "whoCanEditInfo" to null,
                "whoCanDeleteMessages" to null,
                "whoCanMuteMembers" to null,
                "whoCanRemoveMembers" to null,
            )
        val perms = GroupPermissions.fromMap(map)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanSend)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanAddMembers)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanEditInfo)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanDeleteMessages)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanMuteMembers)
        assertEquals(GroupPermissions.PermissionLevel.ADMINS_ONLY, perms.whoCanRemoveMembers)
    }

    @Test
    fun `fromMap falls back to defaults for non-string values`() {
        val map =
            mapOf<String, Any?>(
                "whoCanSend" to 42,
                "whoCanAddMembers" to true,
                "whoCanEditInfo" to listOf("EVERYONE"),
            )
        val perms = GroupPermissions.fromMap(map)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanSend)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanAddMembers)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanEditInfo)
    }

    @Test
    fun `toMap serializes all 6 fields`() {
        val perms =
            GroupPermissions(
                whoCanSend = GroupPermissions.PermissionLevel.MODS_AND_ABOVE,
                whoCanAddMembers = GroupPermissions.PermissionLevel.EVERYONE,
                whoCanEditInfo = GroupPermissions.PermissionLevel.ADMINS_ONLY,
                whoCanDeleteMessages = GroupPermissions.PermissionLevel.OWNER_ONLY,
                whoCanMuteMembers = GroupPermissions.PermissionLevel.MODS_AND_ABOVE,
                whoCanRemoveMembers = GroupPermissions.PermissionLevel.ADMINS_ONLY,
            )
        val map = perms.toMap()
        assertEquals(6, map.size)
        assertEquals("MODS_AND_ABOVE", map["whoCanSend"])
        assertEquals("EVERYONE", map["whoCanAddMembers"])
        assertEquals("ADMINS_ONLY", map["whoCanEditInfo"])
        assertEquals("OWNER_ONLY", map["whoCanDeleteMessages"])
        assertEquals("MODS_AND_ABOVE", map["whoCanMuteMembers"])
        assertEquals("ADMINS_ONLY", map["whoCanRemoveMembers"])
    }

    @Test
    fun `fromMap of toMap round-trip`() {
        val original =
            GroupPermissions(
                whoCanSend = GroupPermissions.PermissionLevel.MODS_AND_ABOVE,
                whoCanAddMembers = GroupPermissions.PermissionLevel.EVERYONE,
                whoCanEditInfo = GroupPermissions.PermissionLevel.ADMINS_ONLY,
                whoCanDeleteMessages = GroupPermissions.PermissionLevel.OWNER_ONLY,
                whoCanMuteMembers = GroupPermissions.PermissionLevel.MODS_AND_ABOVE,
                whoCanRemoveMembers = GroupPermissions.PermissionLevel.ADMINS_ONLY,
            )
        val roundtripped = GroupPermissions.fromMap(original.toMap())
        assertEquals(original, roundtripped)
    }

    @Test
    fun `fromMap of toMap round-trip with defaults`() {
        val original = GroupPermissions()
        val roundtripped = GroupPermissions.fromMap(original.toMap())
        assertEquals(original, roundtripped)
    }

    @Test
    fun `PermissionLevel enum has exactly four values`() {
        val values = GroupPermissions.PermissionLevel.entries
        assertEquals(4, values.size)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, values[0])
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, values[1])
        assertEquals(GroupPermissions.PermissionLevel.ADMINS_ONLY, values[2])
        assertEquals(GroupPermissions.PermissionLevel.OWNER_ONLY, values[3])
    }

    @Test
    fun `backward compat - ADMINS_AND_MODS maps to MODS_AND_ABOVE`() {
        val map =
            mapOf<String, Any?>(
                "whoCanSend" to "ADMINS_AND_MODS",
                "whoCanAddMembers" to "ADMINS_AND_MODS",
                "whoCanEditInfo" to "ADMINS_AND_MODS",
            )
        val perms = GroupPermissions.fromMap(map)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanSend)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanAddMembers)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanEditInfo)
    }

    @Test
    fun `backward compat - missing new fields get correct defaults`() {
        // Simulates an old Firestore doc that only has the original 3 fields
        val map =
            mapOf<String, Any?>(
                "whoCanSend" to "EVERYONE",
                "whoCanAddMembers" to "EVERYONE",
                "whoCanEditInfo" to "EVERYONE",
            )
        val perms = GroupPermissions.fromMap(map)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanSend)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanAddMembers)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanEditInfo)
        // New fields should have their non-EVERYONE defaults
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanDeleteMessages)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanMuteMembers)
        assertEquals(GroupPermissions.PermissionLevel.ADMINS_ONLY, perms.whoCanRemoveMembers)
    }

    @Test
    fun `isAllowed - EVERYONE allows all roles`() {
        val level = GroupPermissions.PermissionLevel.EVERYONE
        assertTrue(level.isAllowed(GroupRole.MEMBER))
        assertTrue(level.isAllowed(GroupRole.MOD))
        assertTrue(level.isAllowed(GroupRole.ADMIN))
        assertTrue(level.isAllowed(GroupRole.OWNER))
    }

    @Test
    fun `isAllowed - MODS_AND_ABOVE allows mod, admin, owner`() {
        val level = GroupPermissions.PermissionLevel.MODS_AND_ABOVE
        assertFalse(level.isAllowed(GroupRole.MEMBER))
        assertTrue(level.isAllowed(GroupRole.MOD))
        assertTrue(level.isAllowed(GroupRole.ADMIN))
        assertTrue(level.isAllowed(GroupRole.OWNER))
    }

    @Test
    fun `isAllowed - ADMINS_ONLY allows admin and owner`() {
        val level = GroupPermissions.PermissionLevel.ADMINS_ONLY
        assertFalse(level.isAllowed(GroupRole.MEMBER))
        assertFalse(level.isAllowed(GroupRole.MOD))
        assertTrue(level.isAllowed(GroupRole.ADMIN))
        assertTrue(level.isAllowed(GroupRole.OWNER))
    }

    @Test
    fun `isAllowed - OWNER_ONLY allows only owner`() {
        val level = GroupPermissions.PermissionLevel.OWNER_ONLY
        assertFalse(level.isAllowed(GroupRole.MEMBER))
        assertFalse(level.isAllowed(GroupRole.MOD))
        assertFalse(level.isAllowed(GroupRole.ADMIN))
        assertTrue(level.isAllowed(GroupRole.OWNER))
    }

    @Test
    fun `displayName values`() {
        assertEquals("Everyone", GroupPermissions.PermissionLevel.EVERYONE.displayName)
        assertEquals("Mods & above", GroupPermissions.PermissionLevel.MODS_AND_ABOVE.displayName)
        assertEquals("Admins only", GroupPermissions.PermissionLevel.ADMINS_ONLY.displayName)
        assertEquals("Owner only", GroupPermissions.PermissionLevel.OWNER_ONLY.displayName)
    }
}
