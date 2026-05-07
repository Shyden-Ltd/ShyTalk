package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class GroupPermissionsTest {
    // ── fromMap ─────────────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "whoCanSend" to "ADMINS_ONLY",
                "whoCanAddMembers" to "MODS_AND_ABOVE",
                "whoCanEditInfo" to "OWNER_ONLY",
                "whoCanDeleteMessages" to "EVERYONE",
                "whoCanMuteMembers" to "ADMINS_ONLY",
                "whoCanRemoveMembers" to "OWNER_ONLY",
            )

        val perms = GroupPermissions.fromMap(map)

        assertEquals(GroupPermissions.PermissionLevel.ADMINS_ONLY, perms.whoCanSend)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanAddMembers)
        assertEquals(GroupPermissions.PermissionLevel.OWNER_ONLY, perms.whoCanEditInfo)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanDeleteMessages)
        assertEquals(GroupPermissions.PermissionLevel.ADMINS_ONLY, perms.whoCanMuteMembers)
        assertEquals(GroupPermissions.PermissionLevel.OWNER_ONLY, perms.whoCanRemoveMembers)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val perms = GroupPermissions.fromMap(emptyMap())

        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanSend)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanAddMembers)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanEditInfo)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanDeleteMessages) // different default
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanMuteMembers) // different default
        assertEquals(GroupPermissions.PermissionLevel.ADMINS_ONLY, perms.whoCanRemoveMembers) // different default
    }

    @Test
    fun `fromMap handles backward compat ADMINS_AND_MODS`() {
        val map = mapOf<String, Any?>("whoCanSend" to "ADMINS_AND_MODS")
        val perms = GroupPermissions.fromMap(map)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanSend)
    }

    @Test
    fun `fromMap handles unknown permission level with default`() {
        val map = mapOf<String, Any?>("whoCanSend" to "INVALID_LEVEL")
        val perms = GroupPermissions.fromMap(map)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanSend) // default for whoCanSend
    }

    @Test
    fun `fromMap handles null permission level`() {
        val map = mapOf<String, Any?>("whoCanSend" to null)
        val perms = GroupPermissions.fromMap(map)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanSend)
    }

    @Test
    fun `fromMap handles non-string value`() {
        val map = mapOf<String, Any?>("whoCanSend" to 42)
        val perms = GroupPermissions.fromMap(map)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanSend)
    }

    // ── toMap ────────────────────────────────────────────────────────

    @Test
    fun `toMap includes all fields as strings`() {
        val perms =
            GroupPermissions(
                whoCanSend = GroupPermissions.PermissionLevel.ADMINS_ONLY,
                whoCanAddMembers = GroupPermissions.PermissionLevel.MODS_AND_ABOVE,
                whoCanEditInfo = GroupPermissions.PermissionLevel.OWNER_ONLY,
                whoCanDeleteMessages = GroupPermissions.PermissionLevel.EVERYONE,
                whoCanMuteMembers = GroupPermissions.PermissionLevel.MODS_AND_ABOVE,
                whoCanRemoveMembers = GroupPermissions.PermissionLevel.OWNER_ONLY,
            )

        val map = perms.toMap()

        assertEquals("ADMINS_ONLY", map["whoCanSend"])
        assertEquals("MODS_AND_ABOVE", map["whoCanAddMembers"])
        assertEquals("OWNER_ONLY", map["whoCanEditInfo"])
        assertEquals("EVERYONE", map["whoCanDeleteMessages"])
        assertEquals("MODS_AND_ABOVE", map["whoCanMuteMembers"])
        assertEquals("OWNER_ONLY", map["whoCanRemoveMembers"])
    }

    // ── roundtrip ───────────────────────────────────────────────────

    @Test
    fun `toMap and fromMap roundtrip preserves data`() {
        val original =
            GroupPermissions(
                whoCanSend = GroupPermissions.PermissionLevel.MODS_AND_ABOVE,
                whoCanAddMembers = GroupPermissions.PermissionLevel.ADMINS_ONLY,
                whoCanEditInfo = GroupPermissions.PermissionLevel.OWNER_ONLY,
                whoCanDeleteMessages = GroupPermissions.PermissionLevel.EVERYONE,
                whoCanMuteMembers = GroupPermissions.PermissionLevel.ADMINS_ONLY,
                whoCanRemoveMembers = GroupPermissions.PermissionLevel.MODS_AND_ABOVE,
            )

        val map = original.toMap()
        val restored = GroupPermissions.fromMap(map)

        assertEquals(original, restored)
    }

    // ── PermissionLevel.isAllowed ───────────────────────────────────

    @Test
    fun `EVERYONE allows all roles`() {
        val level = GroupPermissions.PermissionLevel.EVERYONE
        assertTrue(level.isAllowed(GroupRole.MEMBER))
        assertTrue(level.isAllowed(GroupRole.MOD))
        assertTrue(level.isAllowed(GroupRole.ADMIN))
        assertTrue(level.isAllowed(GroupRole.OWNER))
    }

    @Test
    fun `MODS_AND_ABOVE denies MEMBER`() {
        val level = GroupPermissions.PermissionLevel.MODS_AND_ABOVE
        assertFalse(level.isAllowed(GroupRole.MEMBER))
        assertTrue(level.isAllowed(GroupRole.MOD))
        assertTrue(level.isAllowed(GroupRole.ADMIN))
        assertTrue(level.isAllowed(GroupRole.OWNER))
    }

    @Test
    fun `ADMINS_ONLY denies MEMBER and MOD`() {
        val level = GroupPermissions.PermissionLevel.ADMINS_ONLY
        assertFalse(level.isAllowed(GroupRole.MEMBER))
        assertFalse(level.isAllowed(GroupRole.MOD))
        assertTrue(level.isAllowed(GroupRole.ADMIN))
        assertTrue(level.isAllowed(GroupRole.OWNER))
    }

    @Test
    fun `OWNER_ONLY denies MEMBER MOD and ADMIN`() {
        val level = GroupPermissions.PermissionLevel.OWNER_ONLY
        assertFalse(level.isAllowed(GroupRole.MEMBER))
        assertFalse(level.isAllowed(GroupRole.MOD))
        assertFalse(level.isAllowed(GroupRole.ADMIN))
        assertTrue(level.isAllowed(GroupRole.OWNER))
    }

    // ── PermissionLevel.displayName ─────────────────────────────────

    @Test
    fun `PermissionLevel display names`() {
        assertEquals("Everyone", GroupPermissions.PermissionLevel.EVERYONE.displayName)
        assertEquals("Mods & above", GroupPermissions.PermissionLevel.MODS_AND_ABOVE.displayName)
        assertEquals("Admins only", GroupPermissions.PermissionLevel.ADMINS_ONLY.displayName)
        assertEquals("Owner only", GroupPermissions.PermissionLevel.OWNER_ONLY.displayName)
    }

    // ── Default constructor ─────────────────────────────────────────

    @Test
    fun `default constructor has expected defaults`() {
        val perms = GroupPermissions()
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanSend)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanAddMembers)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, perms.whoCanEditInfo)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanDeleteMessages)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, perms.whoCanMuteMembers)
        assertEquals(GroupPermissions.PermissionLevel.ADMINS_ONLY, perms.whoCanRemoveMembers)
    }
}
