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

    // ── frozenAtMigration (UK OSA #17 PR 8) ──────────────────────────────

    @Test
    fun `frozenAtMigration defaults to false`() {
        // Defensive default — clients that pre-date the field land in
        // the no-banner path. Setting the default to true would render
        // the frozen banner on every existing conversation immediately
        // after rollout.
        val conversation = Conversation()
        assertEquals(false, conversation.frozenAtMigration)
    }

    @Test
    fun `fromMap reads frozenAtMigration when present`() {
        val conv =
            Conversation.fromMap(
                mapOf(
                    "participantIds" to listOf("100", "200"),
                    "frozenAtMigration" to true,
                ),
                "convo-1",
            )
        assertTrue(conv.frozenAtMigration)
    }

    @Test
    fun `fromMap defaults frozenAtMigration to false when absent`() {
        // Backward-compat: every pre-PR-8 conv doc lacks the field.
        // `asBool()` on null returns false — the safe default that
        // keeps existing convs out of the freeze banner path.
        val conv =
            Conversation.fromMap(
                mapOf("participantIds" to listOf("100", "200")),
                "convo-1",
            )
        assertEquals(false, conv.frozenAtMigration)
    }

    @Test
    fun `fromMap reads frozenAtMigration false explicitly`() {
        val conv =
            Conversation.fromMap(
                mapOf(
                    "participantIds" to listOf("100", "200"),
                    "frozenAtMigration" to false,
                ),
                "convo-1",
            )
        assertEquals(false, conv.frozenAtMigration)
    }

    @Test
    fun `toMap deliberately omits frozenAtMigration (server-only flag immutability defence)`() {
        // The flag is set ONLY by the migration script via Admin SDK.
        // If `toMap()` included the flag, every benign client write
        // (groupName edit, etc.) would round-trip the value back to
        // Firestore — and a client that constructed a Conversation
        // with `frozenAtMigration=false` (the default) and wrote it
        // back via `toMap()` would clobber a previously-frozen flag
        // to false. firestore.rules independently blocks this on
        // update, but the data-model-layer defence is the first line.
        val conv =
            Conversation(
                conversationId = "convo-1",
                participantIds = listOf("100", "200"),
                isGroup = true,
                frozenAtMigration = true,
            )
        assertEquals(false, conv.toMap().containsKey("frozenAtMigration"))
    }
}
