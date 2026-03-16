package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class ConversationBusinessTest {
    // ── generateId ────────────────────────────────────────────────────────

    @Test
    fun `generateId is commutative`() {
        val ab = Conversation.generateId("user-a", "user-b")
        val ba = Conversation.generateId("user-b", "user-a")
        assertEquals(ab, ba)
    }

    // ── otherUserId ───────────────────────────────────────────────────────

    @Test
    fun `otherUserId returns other participant in two-person conversation`() {
        val conversation =
            Conversation(
                participantIds = listOf("user-1", "user-2"),
            )
        assertEquals("user-2", conversation.otherUserId("user-1"))
    }

    @Test
    fun `otherUserId returns null when participant list has one entry`() {
        val conversation =
            Conversation(
                participantIds = listOf("user-1"),
            )
        assertNull(conversation.otherUserId("user-1"))
    }

    // ── isAdmin ───────────────────────────────────────────────────────────

    @Test
    fun `isAdmin returns true for createdBy user`() {
        val conversation =
            Conversation(
                isGroup = true,
                createdBy = "owner-1",
                groupAdminIds = emptyList(),
            )
        assertTrue(conversation.isAdmin("owner-1"))
    }

    @Test
    fun `isAdmin returns true for user in groupAdminIds`() {
        val conversation =
            Conversation(
                isGroup = true,
                createdBy = "owner-1",
                groupAdminIds = listOf("admin-1", "admin-2"),
            )
        assertTrue(conversation.isAdmin("admin-1"))
    }

    // ── isMod ─────────────────────────────────────────────────────────────

    @Test
    fun `isMod returns true for user in groupModIds`() {
        val conversation =
            Conversation(
                isGroup = true,
                groupModIds = listOf("mod-1", "mod-2"),
            )
        assertTrue(conversation.isMod("mod-1"))
    }

    // ── isModOrAbove ──────────────────────────────────────────────────────

    @Test
    fun `isModOrAbove returns true for admin`() {
        val conversation =
            Conversation(
                isGroup = true,
                createdBy = "owner-1",
                groupAdminIds = listOf("admin-1"),
            )
        assertTrue(conversation.isModOrAbove("admin-1"))
        assertTrue(conversation.isModOrAbove("owner-1"))
    }

    // ── roleOf ────────────────────────────────────────────────────────────

    @Test
    fun `roleOf returns OWNER for createdBy`() {
        val conversation =
            Conversation(
                isGroup = true,
                createdBy = "owner-1",
                groupAdminIds = listOf("admin-1"),
                groupModIds = listOf("mod-1"),
            )
        assertEquals(GroupRole.OWNER, conversation.roleOf("owner-1"))
    }

    @Test
    fun `roleOf returns MEMBER for non-privileged user`() {
        val conversation =
            Conversation(
                isGroup = true,
                createdBy = "owner-1",
                groupAdminIds = listOf("admin-1"),
                groupModIds = listOf("mod-1"),
            )
        assertEquals(GroupRole.MEMBER, conversation.roleOf("regular-user"))
    }
}
