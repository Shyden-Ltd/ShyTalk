package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.util.Date

class ConversationFromMapTest {
    private val tsMillis = 1_000_000_000L
    private val ts = Timestamp(Date(tsMillis))

    // ===== fromMap / toMap =====

    @Test
    fun `fromMap parses 1-on-1 conversation`() {
        val map =
            mapOf<String, Any?>(
                "participantIds" to listOf("user-1", "user-2"),
                "lastMessageAt" to ts,
                "createdAt" to ts,
                "isGroup" to false,
            )
        val conv = Conversation.fromMap(map, "conv-1")

        assertEquals("conv-1", conv.conversationId)
        assertEquals(listOf("user-1", "user-2"), conv.participantIds)
        assertNull(conv.lastMessage)
        assertEquals(tsMillis, conv.lastMessageAt)
        assertEquals(tsMillis, conv.createdAt)
        assertFalse(conv.isGroup)
        assertNull(conv.groupName)
        assertNull(conv.groupPhotoUrl)
        assertEquals(emptyList<String>(), conv.groupAdminIds)
        assertNull(conv.createdBy)
    }

    @Test
    fun `fromMap parses group conversation`() {
        val map =
            mapOf<String, Any?>(
                "participantIds" to listOf("user-1", "user-2", "user-3"),
                "lastMessageAt" to ts,
                "createdAt" to ts,
                "isGroup" to true,
                "groupName" to "Cool Group",
                "groupPhotoUrl" to "https://group.png",
                "groupAdminIds" to listOf("user-1"),
                "createdBy" to "user-1",
            )
        val conv = Conversation.fromMap(map, "conv-1")

        assertTrue(conv.isGroup)
        assertEquals("Cool Group", conv.groupName)
        assertEquals("https://group.png", conv.groupPhotoUrl)
        assertEquals(listOf("user-1"), conv.groupAdminIds)
        assertEquals("user-1", conv.createdBy)
    }

    @Test
    fun `fromMap handles empty map with defaults`() {
        val conv = Conversation.fromMap(emptyMap(), "conv-1")

        assertEquals("conv-1", conv.conversationId)
        assertEquals(emptyList<String>(), conv.participantIds)
        assertNull(conv.lastMessage)
        assertFalse(conv.isGroup)
        assertNull(conv.groupName)
        assertNull(conv.groupPhotoUrl)
        assertEquals(emptyList<String>(), conv.groupAdminIds)
        assertNull(conv.createdBy)
    }

    @Test
    fun `fromMap parses lastMessage sub-map`() {
        val lastMsgMap =
            mapOf<String, Any?>(
                "text" to "Hey!",
                "senderId" to "user-1",
                "senderName" to "Alice",
                "createdAt" to ts,
                "type" to "TEXT",
            )
        val map =
            mapOf<String, Any?>(
                "lastMessage" to lastMsgMap,
                "lastMessageAt" to ts,
                "createdAt" to ts,
            )
        val conv = Conversation.fromMap(map, "conv-1")

        val lm = conv.lastMessage
        assertEquals("Hey!", lm?.text)
        assertEquals("user-1", lm?.senderId)
        assertEquals("Alice", lm?.senderName)
        assertEquals(tsMillis, lm?.createdAt)
        assertEquals("TEXT", lm?.type)
    }

    @Test
    fun `fromMap handles lastMessage null`() {
        val map = mapOf<String, Any?>("lastMessage" to null)
        val conv = Conversation.fromMap(map, "conv-1")
        assertNull(conv.lastMessage)
    }

    @Test
    fun `fromMap converts all participantIds to strings and filters nulls`() {
        val map =
            mapOf<String, Any?>(
                "participantIds" to listOf("user-1", 42L, null, "user-2"),
            )
        val conv = Conversation.fromMap(map, "conv-1")
        // Numeric IDs are converted to String; nulls are filtered out
        assertEquals(listOf("user-1", "42", "user-2"), conv.participantIds)
    }

    @Test
    fun `fromMap filters non-string items from groupAdminIds`() {
        val map =
            mapOf<String, Any?>(
                "groupAdminIds" to listOf("user-1", 99, null),
            )
        val conv = Conversation.fromMap(map, "conv-1")
        assertEquals(listOf("user-1"), conv.groupAdminIds)
    }

    @Test
    fun `toMap includes group fields only for group conversations`() {
        val group =
            Conversation(
                conversationId = "conv-1",
                isGroup = true,
                groupName = "Group",
                groupPhotoUrl = "https://photo.png",
                groupAdminIds = listOf("user-1"),
                createdBy = "user-1",
                lastMessageAt = tsMillis,
                createdAt = tsMillis,
            )
        val groupMap = group.toMap()
        assertTrue(groupMap.containsKey("groupName"))
        assertTrue(groupMap.containsKey("groupPhotoUrl"))
        assertTrue(groupMap.containsKey("groupAdminIds"))
        assertTrue(groupMap.containsKey("createdBy"))
    }

    @Test
    fun `toMap omits group fields for 1-on-1 conversations`() {
        val oneOnOne =
            Conversation(
                conversationId = "conv-1",
                isGroup = false,
                lastMessageAt = tsMillis,
                createdAt = tsMillis,
            )
        val map = oneOnOne.toMap()
        assertFalse(map.containsKey("groupName"))
        assertFalse(map.containsKey("groupPhotoUrl"))
        assertFalse(map.containsKey("groupAdminIds"))
        assertFalse(map.containsKey("createdBy"))
    }

    @Test
    fun `fromMap of toMap round-trip for 1-on-1`() {
        val original =
            Conversation(
                conversationId = "conv-1",
                participantIds = listOf("user-1", "user-2"),
                lastMessage =
                    ConversationPreview(
                        text = "Hi",
                        senderId = "user-1",
                        senderName = "Alice",
                        createdAt = tsMillis,
                        type = "TEXT",
                    ),
                lastMessageAt = tsMillis,
                createdAt = tsMillis,
                isGroup = false,
            )
        val roundtripped = Conversation.fromMap(original.toMap(), "conv-1")
        assertEquals(original, roundtripped)
    }

    @Test
    fun `fromMap of toMap round-trip for group`() {
        val original =
            Conversation(
                conversationId = "conv-g",
                participantIds = listOf("user-1", "user-2", "user-3"),
                lastMessage = null,
                lastMessageAt = tsMillis,
                createdAt = tsMillis,
                isGroup = true,
                groupName = "Test Group",
                groupPhotoUrl = "https://group.png",
                groupAdminIds = listOf("user-1"),
                createdBy = "user-1",
            )
        val roundtripped = Conversation.fromMap(original.toMap(), "conv-g")
        assertEquals(original, roundtripped)
    }

    // ===== Helper methods =====

    @Test
    fun `generateId sorts UIDs alphabetically`() {
        assertEquals("abc_xyz", Conversation.generateId("xyz", "abc"))
        assertEquals("abc_xyz", Conversation.generateId("abc", "xyz"))
    }

    @Test
    fun `generateId is symmetric`() {
        val id1 = Conversation.generateId("user-1", "user-2")
        val id2 = Conversation.generateId("user-2", "user-1")
        assertEquals(id1, id2)
    }

    @Test
    fun `otherUserId returns the other participant`() {
        val conv = Conversation(participantIds = listOf("user-1", "user-2"))
        assertEquals("user-2", conv.otherUserId("user-1"))
        assertEquals("user-1", conv.otherUserId("user-2"))
    }

    @Test
    fun `otherUserId returns first non-matching for non-participant`() {
        val conv = Conversation(participantIds = listOf("user-1", "user-2"))
        // "user-3" is not a participant, so firstOrNull { it != "user-3" } returns "user-1"
        assertEquals("user-1", conv.otherUserId("user-3"))
    }

    @Test
    fun `isAdmin checks groupAdminIds and createdBy`() {
        val conv =
            Conversation(
                isGroup = true,
                groupAdminIds = listOf("admin-1"),
                createdBy = "creator-1",
            )
        assertTrue(conv.isAdmin("admin-1"))
        assertTrue(conv.isAdmin("creator-1"))
        assertFalse(conv.isAdmin("user-99"))
    }

    @Test
    fun `isOneOnOne reflects isGroup`() {
        val oneOnOne = Conversation(isGroup = false)
        assertTrue(oneOnOne.isOneOnOne)

        val group = Conversation(isGroup = true)
        assertFalse(group.isOneOnOne)
    }

    @Test
    fun `fromMap parses isClosed true`() {
        val map = mapOf<String, Any?>("isClosed" to true)
        val conv = Conversation.fromMap(map, "conv-1")
        assertTrue(conv.isClosed)
    }

    @Test
    fun `fromMap defaults isClosed to false when missing`() {
        val conv = Conversation.fromMap(emptyMap(), "conv-1")
        assertFalse(conv.isClosed)
    }

    @Test
    fun `toMap includes isClosed`() {
        val conv = Conversation(conversationId = "conv-1", isClosed = true, lastMessageAt = tsMillis, createdAt = tsMillis)
        val map = conv.toMap()
        assertEquals(true, map["isClosed"])
    }

    // ===== New fields: groupModIds, groupDescription, permissions, systemMessageConfig, modNotifyMode =====

    @Test
    fun `fromMap parses group with new fields`() {
        val permissionsMap =
            mapOf<String, Any?>(
                "whoCanSend" to "MODS_AND_ABOVE",
                "whoCanAddMembers" to "EVERYONE",
                "whoCanEditInfo" to "MODS_AND_ABOVE",
            )
        val sysConfigMap =
            mapOf<String, Any?>(
                "showJoins" to false,
                "showLeaves" to true,
                "showRoleChanges" to false,
                "showPermissionChanges" to true,
            )
        val map =
            mapOf<String, Any?>(
                "isGroup" to true,
                "groupModIds" to listOf("mod-1", "mod-2"),
                "groupDescription" to "A cool group",
                "permissions" to permissionsMap,
                "systemMessageConfig" to sysConfigMap,
                "modNotifyMode" to "OWNER_ONLY",
                "lastMessageAt" to ts,
                "createdAt" to ts,
            )
        val conv = Conversation.fromMap(map, "conv-g")

        assertEquals(listOf("mod-1", "mod-2"), conv.groupModIds)
        assertEquals("A cool group", conv.groupDescription)
        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, conv.permissions.whoCanSend)
        assertEquals(GroupPermissions.PermissionLevel.EVERYONE, conv.permissions.whoCanAddMembers)
        assertFalse(conv.systemMessageConfig.showJoins)
        assertTrue(conv.systemMessageConfig.showLeaves)
        assertEquals("OWNER_ONLY", conv.modNotifyMode)
    }

    @Test
    fun `fromMap defaults new fields when missing`() {
        val conv = Conversation.fromMap(emptyMap(), "conv-1")

        assertEquals(emptyList<String>(), conv.groupModIds)
        assertNull(conv.groupDescription)
        assertEquals(GroupPermissions(), conv.permissions)
        assertEquals(SystemMessageConfig(), conv.systemMessageConfig)
        assertEquals("ALL_ADMINS", conv.modNotifyMode)
    }

    @Test
    fun `fromMap filters non-string items from groupModIds`() {
        val map =
            mapOf<String, Any?>(
                "groupModIds" to listOf("mod-1", 42, null, "mod-2"),
            )
        val conv = Conversation.fromMap(map, "conv-1")
        assertEquals(listOf("mod-1", "mod-2"), conv.groupModIds)
    }

    @Test
    fun `toMap includes new group fields for group conversations`() {
        val group =
            Conversation(
                conversationId = "conv-g",
                isGroup = true,
                groupModIds = listOf("mod-1"),
                groupDescription = "Description",
                permissions =
                    GroupPermissions(
                        whoCanSend = GroupPermissions.PermissionLevel.MODS_AND_ABOVE,
                    ),
                systemMessageConfig = SystemMessageConfig(showJoins = false),
                modNotifyMode = "OWNER_ONLY",
                lastMessageAt = tsMillis,
                createdAt = tsMillis,
            )
        val map = group.toMap()
        assertEquals(listOf("mod-1"), map["groupModIds"])
        assertEquals("Description", map["groupDescription"])
        assertTrue(map.containsKey("permissions"))
        assertTrue(map.containsKey("systemMessageConfig"))
        assertEquals("OWNER_ONLY", map["modNotifyMode"])
    }

    @Test
    fun `toMap omits new group fields for 1-on-1`() {
        val oneOnOne =
            Conversation(
                conversationId = "conv-1",
                isGroup = false,
                lastMessageAt = tsMillis,
                createdAt = tsMillis,
            )
        val map = oneOnOne.toMap()
        assertFalse(map.containsKey("groupModIds"))
        assertFalse(map.containsKey("groupDescription"))
        assertFalse(map.containsKey("permissions"))
        assertFalse(map.containsKey("systemMessageConfig"))
        assertFalse(map.containsKey("modNotifyMode"))
    }

    @Test
    fun `fromMap of toMap round-trip for group with all new fields`() {
        val original =
            Conversation(
                conversationId = "conv-g",
                participantIds = listOf("user-1", "user-2", "user-3"),
                lastMessageAt = tsMillis,
                createdAt = tsMillis,
                isGroup = true,
                groupName = "Full Group",
                groupAdminIds = listOf("user-1"),
                groupModIds = listOf("user-2"),
                groupDescription = "A test group",
                createdBy = "user-1",
                permissions =
                    GroupPermissions(
                        whoCanSend = GroupPermissions.PermissionLevel.MODS_AND_ABOVE,
                        whoCanAddMembers = GroupPermissions.PermissionLevel.EVERYONE,
                        whoCanEditInfo = GroupPermissions.PermissionLevel.MODS_AND_ABOVE,
                    ),
                systemMessageConfig =
                    SystemMessageConfig(
                        showJoins = false,
                        showLeaves = true,
                        showRoleChanges = false,
                        showPermissionChanges = true,
                    ),
                modNotifyMode = "OWNER_ONLY",
            )
        val roundtripped = Conversation.fromMap(original.toMap(), "conv-g")
        assertEquals(original, roundtripped)
    }

    // ===== roleOf / isMod / isModOrAbove =====

    @Test
    fun `isMod checks groupModIds`() {
        val conv =
            Conversation(
                isGroup = true,
                groupModIds = listOf("mod-1", "mod-2"),
            )
        assertTrue(conv.isMod("mod-1"))
        assertTrue(conv.isMod("mod-2"))
        assertFalse(conv.isMod("user-99"))
    }

    @Test
    fun `isModOrAbove returns true for mods admins and owner`() {
        val conv =
            Conversation(
                isGroup = true,
                groupAdminIds = listOf("admin-1"),
                groupModIds = listOf("mod-1"),
                createdBy = "owner-1",
            )
        assertTrue(conv.isModOrAbove("owner-1"))
        assertTrue(conv.isModOrAbove("admin-1"))
        assertTrue(conv.isModOrAbove("mod-1"))
        assertFalse(conv.isModOrAbove("member-1"))
    }

    @Test
    fun `roleOf returns correct role for each participant type`() {
        val conv =
            Conversation(
                isGroup = true,
                groupAdminIds = listOf("admin-1"),
                groupModIds = listOf("mod-1"),
                createdBy = "owner-1",
            )
        assertEquals(GroupRole.OWNER, conv.roleOf("owner-1"))
        assertEquals(GroupRole.ADMIN, conv.roleOf("admin-1"))
        assertEquals(GroupRole.MOD, conv.roleOf("mod-1"))
        assertEquals(GroupRole.MEMBER, conv.roleOf("random-user"))
    }

    @Test
    fun `roleOf prioritises owner over admin`() {
        // owner is also in groupAdminIds
        val conv =
            Conversation(
                isGroup = true,
                groupAdminIds = listOf("user-1"),
                createdBy = "user-1",
            )
        assertEquals(GroupRole.OWNER, conv.roleOf("user-1"))
    }

    @Test
    fun `GroupRole enum has exactly four values`() {
        val values = GroupRole.entries
        assertEquals(4, values.size)
        assertEquals(GroupRole.OWNER, values[0])
        assertEquals(GroupRole.ADMIN, values[1])
        assertEquals(GroupRole.MOD, values[2])
        assertEquals(GroupRole.MEMBER, values[3])
    }
}
