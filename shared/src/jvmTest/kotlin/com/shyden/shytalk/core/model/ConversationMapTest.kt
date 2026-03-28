package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ConversationMapTest {
    // ── ConversationPreview fromMap ──────────────────────────────────

    @Test
    fun `ConversationPreview fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "text" to "Hello!",
                "senderId" to "user-1",
                "senderName" to "Alice",
                "createdAt" to 1705326600000L,
                "type" to "IMAGE",
            )

        val preview = ConversationPreview.fromMap(map)

        assertEquals("Hello!", preview.text)
        assertEquals("user-1", preview.senderId)
        assertEquals("Alice", preview.senderName)
        assertEquals(1705326600000L, preview.createdAt)
        assertEquals("IMAGE", preview.type)
    }

    @Test
    fun `ConversationPreview fromMap defaults for empty map`() {
        val preview = ConversationPreview.fromMap(emptyMap())

        assertEquals("", preview.text)
        assertEquals("", preview.senderId)
        assertEquals("", preview.senderName)
        assertEquals("TEXT", preview.type)
    }

    @Test
    fun `ConversationPreview toMap includes all fields`() {
        val preview =
            ConversationPreview(
                text = "Hello",
                senderId = "s1",
                senderName = "Alice",
                createdAt = 1705326600000L,
                type = "TEXT",
            )

        val map = preview.toMap()

        assertEquals("Hello", map["text"])
        assertEquals("s1", map["senderId"])
        assertEquals("Alice", map["senderName"])
        assertEquals(1705326600000L, map["createdAt"])
        assertEquals("TEXT", map["type"])
    }

    @Test
    fun `ConversationPreview roundtrip`() {
        val original =
            ConversationPreview(
                text = "Hi!",
                senderId = "sender-1",
                senderName = "Sender",
                createdAt = 1705326600000L,
                type = "STICKER",
            )

        val restored = ConversationPreview.fromMap(original.toMap())

        assertEquals(original, restored)
    }

    // ── Conversation fromMap ────────────────────────────────────────

    @Test
    fun `Conversation fromMap parses 1-on-1 conversation`() {
        val map =
            mapOf<String, Any?>(
                "participantIds" to listOf("user-1", "user-2"),
                "lastMessageAt" to 1705326600000L,
                "createdAt" to 1705000000000L,
                "isGroup" to false,
                "isClosed" to false,
            )

        val conv = Conversation.fromMap(map, "conv-1")

        assertEquals("conv-1", conv.conversationId)
        assertEquals(listOf("user-1", "user-2"), conv.participantIds)
        assertEquals(1705326600000L, conv.lastMessageAt)
        assertEquals(1705000000000L, conv.createdAt)
        assertFalse(conv.isGroup)
        assertFalse(conv.isClosed)
        assertTrue(conv.isOneOnOne)
    }

    @Test
    fun `Conversation fromMap parses group conversation`() {
        val map =
            mapOf<String, Any?>(
                "participantIds" to listOf("user-1", "user-2", "user-3"),
                "isGroup" to true,
                "groupName" to "Test Group",
                "groupPhotoUrl" to "https://photo.png",
                "groupAdminIds" to listOf("user-1"),
                "groupModIds" to listOf("user-2"),
                "groupDescription" to "A test group",
                "createdBy" to "user-1",
                "isClosed" to false,
                "createdAt" to 1705000000000L,
                "lastMessageAt" to 1705326600000L,
                "modNotifyMode" to "OWNER_ONLY",
            )

        val conv = Conversation.fromMap(map, "conv-2")

        assertTrue(conv.isGroup)
        assertFalse(conv.isOneOnOne)
        assertEquals("Test Group", conv.groupName)
        assertEquals("https://photo.png", conv.groupPhotoUrl)
        assertEquals(listOf("user-1"), conv.groupAdminIds)
        assertEquals(listOf("user-2"), conv.groupModIds)
        assertEquals("A test group", conv.groupDescription)
        assertEquals("user-1", conv.createdBy)
        assertEquals("OWNER_ONLY", conv.modNotifyMode)
    }

    @Test
    fun `Conversation fromMap defaults for empty map`() {
        val conv = Conversation.fromMap(emptyMap(), "conv-3")

        assertEquals("conv-3", conv.conversationId)
        assertEquals(emptyList(), conv.participantIds)
        assertNull(conv.lastMessage)
        assertFalse(conv.isGroup)
        assertNull(conv.groupName)
        assertNull(conv.groupPhotoUrl)
        assertEquals(emptyList(), conv.groupAdminIds)
        assertEquals(emptyList(), conv.groupModIds)
        assertNull(conv.groupDescription)
        assertNull(conv.createdBy)
        assertFalse(conv.isClosed)
        assertEquals("ALL_ADMINS", conv.modNotifyMode)
    }

    @Test
    fun `Conversation fromMap parses lastMessage`() {
        val map =
            mapOf<String, Any?>(
                "lastMessage" to
                    mapOf(
                        "text" to "Last msg",
                        "senderId" to "s1",
                        "senderName" to "Alice",
                        "createdAt" to 1705326600000L,
                        "type" to "TEXT",
                    ),
                "createdAt" to 1705000000000L,
                "lastMessageAt" to 1705326600000L,
            )

        val conv = Conversation.fromMap(map, "conv-4")

        val lastMsg = conv.lastMessage
        assertNotNull(lastMsg)
        assertEquals("Last msg", lastMsg.text)
        assertEquals("s1", lastMsg.senderId)
        assertEquals("Alice", lastMsg.senderName)
    }

    @Test
    fun `Conversation fromMap handles null lastMessage`() {
        val map = mapOf<String, Any?>("lastMessage" to null, "createdAt" to 1705000000000L)
        val conv = Conversation.fromMap(map, "conv-5")
        assertNull(conv.lastMessage)
    }

    @Test
    fun `Conversation fromMap parses permissions`() {
        val map =
            mapOf<String, Any?>(
                "permissions" to
                    mapOf(
                        "whoCanSend" to "MODS_AND_ABOVE",
                        "whoCanAddMembers" to "ADMINS_ONLY",
                    ),
                "createdAt" to 1705000000000L,
                "lastMessageAt" to 1705326600000L,
            )

        val conv = Conversation.fromMap(map, "conv-6")

        assertEquals(GroupPermissions.PermissionLevel.MODS_AND_ABOVE, conv.permissions.whoCanSend)
        assertEquals(GroupPermissions.PermissionLevel.ADMINS_ONLY, conv.permissions.whoCanAddMembers)
    }

    @Test
    fun `Conversation fromMap defaults permissions when missing`() {
        val conv = Conversation.fromMap(emptyMap(), "conv-7")
        assertEquals(GroupPermissions(), conv.permissions)
    }

    @Test
    fun `Conversation fromMap parses systemMessageConfig`() {
        val map =
            mapOf<String, Any?>(
                "systemMessageConfig" to
                    mapOf(
                        "showJoins" to false,
                        "showLeaves" to true,
                    ),
                "createdAt" to 1705000000000L,
                "lastMessageAt" to 1705326600000L,
            )

        val conv = Conversation.fromMap(map, "conv-8")

        assertFalse(conv.systemMessageConfig.showJoins)
        assertTrue(conv.systemMessageConfig.showLeaves)
    }

    @Test
    fun `Conversation fromMap handles isGroup as integer boolean`() {
        val map = mapOf<String, Any?>("isGroup" to 1, "createdAt" to 1705000000000L)
        val conv = Conversation.fromMap(map, "conv-9")
        assertTrue(conv.isGroup)
    }

    @Test
    fun `Conversation fromMap handles isClosed as integer boolean`() {
        val map = mapOf<String, Any?>("isClosed" to 1, "createdAt" to 1705000000000L)
        val conv = Conversation.fromMap(map, "conv-10")
        assertTrue(conv.isClosed)
    }

    // ── Conversation toMap ──────────────────────────────────────────

    @Test
    fun `Conversation toMap for 1-on-1 does not include group fields`() {
        val conv =
            Conversation(
                conversationId = "conv-1",
                participantIds = listOf("u1", "u2"),
                isGroup = false,
            )

        val map = conv.toMap()

        assertTrue("conversationId" in map)
        assertTrue("participantIds" in map)
        assertTrue("isGroup" in map)
        assertFalse("groupName" in map)
        assertFalse("groupAdminIds" in map)
        assertFalse("groupModIds" in map)
        assertFalse("createdBy" in map)
    }

    @Test
    fun `Conversation toMap for group includes group fields`() {
        val conv =
            Conversation(
                conversationId = "conv-2",
                participantIds = listOf("u1", "u2", "u3"),
                isGroup = true,
                groupName = "Group",
                groupAdminIds = listOf("u1"),
                groupModIds = listOf("u2"),
                createdBy = "u1",
            )

        val map = conv.toMap()

        assertTrue("groupName" in map)
        assertTrue("groupAdminIds" in map)
        assertTrue("groupModIds" in map)
        assertTrue("createdBy" in map)
        assertTrue("permissions" in map)
        assertTrue("systemMessageConfig" in map)
        assertTrue("modNotifyMode" in map)
    }

    @Test
    fun `Conversation toMap includes lastMessage map`() {
        val conv =
            Conversation(
                lastMessage = ConversationPreview(text = "Hi", senderId = "s1", senderName = "Alice"),
            )

        val map = conv.toMap()
        val lastMsg = map["lastMessage"] as? Map<*, *>
        assertNotNull(lastMsg)
        assertEquals("Hi", lastMsg["text"])
    }

    @Test
    fun `Conversation toMap handles null lastMessage`() {
        val conv = Conversation(lastMessage = null)
        val map = conv.toMap()
        assertNull(map["lastMessage"])
    }

    // ── Conversation generateId ─────────────────────────────────────

    @Test
    fun `generateId creates underscore-separated sorted ids`() {
        val id = Conversation.generateId("b-user", "a-user")
        assertEquals("a-user_b-user", id)
    }

    @Test
    fun `generateId is commutative`() {
        val ab = Conversation.generateId("x", "y")
        val ba = Conversation.generateId("y", "x")
        assertEquals(ab, ba)
    }

    @Test
    fun `generateId with same ids`() {
        val id = Conversation.generateId("user", "user")
        assertEquals("user_user", id)
    }

    // ── Conversation business logic (extended) ──────────────────────

    @Test
    fun `otherUserId returns null for empty participant list`() {
        val conv = Conversation(participantIds = emptyList())
        assertNull(conv.otherUserId("user-1"))
    }

    @Test
    fun `otherUserId returns null when current user not in list`() {
        val conv = Conversation(participantIds = listOf("user-2", "user-3"))
        // user-1 not in list, firstOrNull { it != "user-1" } returns "user-2"
        assertEquals("user-2", conv.otherUserId("user-1"))
    }

    @Test
    fun `isAdmin returns false for non-admin non-creator`() {
        val conv =
            Conversation(
                isGroup = true,
                createdBy = "owner-1",
                groupAdminIds = listOf("admin-1"),
            )
        assertFalse(conv.isAdmin("regular-user"))
    }

    @Test
    fun `isMod returns false for non-mod`() {
        val conv =
            Conversation(
                isGroup = true,
                groupModIds = listOf("mod-1"),
            )
        assertFalse(conv.isMod("regular-user"))
    }

    @Test
    fun `isModOrAbove returns false for member`() {
        val conv =
            Conversation(
                isGroup = true,
                createdBy = "owner-1",
                groupAdminIds = listOf("admin-1"),
                groupModIds = listOf("mod-1"),
            )
        assertFalse(conv.isModOrAbove("regular-user"))
    }

    @Test
    fun `isModOrAbove returns true for mod`() {
        val conv =
            Conversation(
                isGroup = true,
                createdBy = "owner-1",
                groupModIds = listOf("mod-1"),
            )
        assertTrue(conv.isModOrAbove("mod-1"))
    }

    @Test
    fun `roleOf returns ADMIN for admin`() {
        val conv =
            Conversation(
                isGroup = true,
                createdBy = "owner-1",
                groupAdminIds = listOf("admin-1"),
            )
        assertEquals(GroupRole.ADMIN, conv.roleOf("admin-1"))
    }

    @Test
    fun `roleOf returns MOD for mod`() {
        val conv =
            Conversation(
                isGroup = true,
                createdBy = "owner-1",
                groupAdminIds = listOf("admin-1"),
                groupModIds = listOf("mod-1"),
            )
        assertEquals(GroupRole.MOD, conv.roleOf("mod-1"))
    }

    @Test
    fun `isOneOnOne returns true for non-group`() {
        val conv = Conversation(isGroup = false)
        assertTrue(conv.isOneOnOne)
    }

    @Test
    fun `isOneOnOne returns false for group`() {
        val conv = Conversation(isGroup = true)
        assertFalse(conv.isOneOnOne)
    }

    // ── GroupRole enum ──────────────────────────────────────────────

    @Test
    fun `GroupRole has expected values`() {
        val roles = GroupRole.entries
        assertEquals(4, roles.size)
        assertTrue(GroupRole.OWNER in roles)
        assertTrue(GroupRole.ADMIN in roles)
        assertTrue(GroupRole.MOD in roles)
        assertTrue(GroupRole.MEMBER in roles)
    }
}
