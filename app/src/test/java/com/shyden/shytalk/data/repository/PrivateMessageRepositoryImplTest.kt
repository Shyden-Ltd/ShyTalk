package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class PrivateMessageRepositoryImplTest {

    private lateinit var api: WorkerApiClient
    private lateinit var repo: PrivateMessageRepositoryImpl

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        repo = PrivateMessageRepositoryImpl(api)
    }

    // region getOrCreateConversation

    @Test
    fun `getOrCreateConversation returns Success with conversation`() = runTest {
        coEvery { api.post("/api/conversations", any()) } returns JSONObject().apply {
            put("id", "conv-123")
            put("isGroup", false)
            put("createdAt", 1700000000000L)
            put("lastMessageAt", 1700000000000L)
        }

        val result = repo.getOrCreateConversation("uid1", "uid2")

        assertTrue(result is Resource.Success)
        assertEquals("conv-123", (result as Resource.Success).data.conversationId)
        coVerify { api.post("/api/conversations", any()) }
    }

    @Test
    fun `getOrCreateConversation returns Error on exception`() = runTest {
        coEvery { api.post("/api/conversations", any()) } throws RuntimeException("Fail")

        val result = repo.getOrCreateConversation("uid1", "uid2")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region getConversationSettings

    @Test
    fun `getConversationSettings returns Success`() = runTest {
        coEvery { api.get("/api/conversations/conv-1/settings") } returns JSONObject().apply {
            put("isMuted", false)
            put("isPinned", false)
            put("isHidden", false)
            put("unreadCount", 0)
        }

        val result = repo.getConversationSettings("conv-1", "user-1")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region sendTextMessage

    @Test
    fun `sendTextMessage returns Success`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/messages", any()) } returns JSONObject().apply {
            put("id", "msg-1")
        }

        val result = repo.sendTextMessage("conv-1", "user-1", "Alice", "Hello!")

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/conversations/conv-1/messages", any()) }
    }

    @Test
    fun `sendTextMessage returns Error on exception`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/messages", any()) } throws RuntimeException("Fail")

        val result = repo.sendTextMessage("conv-1", "user-1", "Alice", "Hello!")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region sendImageMessage

    @Test
    fun `sendImageMessage returns Success`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/messages", any()) } returns JSONObject().apply {
            put("id", "msg-2")
        }

        val result = repo.sendImageMessage(
            "conv-1", "user-1", "Alice", listOf("https://img.example.com/1.jpg")
        )

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region editMessage

    @Test
    fun `editMessage returns Success`() = runTest {
        coEvery { api.patch("/api/conversations/conv-1/messages/msg-1", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.editMessage("conv-1", "msg-1", "Updated text")

        assertTrue(result is Resource.Success)
        coVerify { api.patch("/api/conversations/conv-1/messages/msg-1", any()) }
    }

    @Test
    fun `editMessage returns Error on exception`() = runTest {
        coEvery { api.patch("/api/conversations/conv-1/messages/msg-1", any()) } throws RuntimeException("Fail")

        val result = repo.editMessage("conv-1", "msg-1", "Updated text")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region getEditHistory

    @Test
    fun `getEditHistory returns Success`() = runTest {
        coEvery { api.getArray("/api/conversations/conv-1/messages/msg-1/edits") } returns JSONArray().apply {
            put(JSONObject().apply {
                put("id", "edit-1")
                put("previousText", "Old text")
                put("editedAt", 1700000000000L)
            })
        }

        val result = repo.getEditHistory("conv-1", "msg-1")

        assertTrue(result is Resource.Success)
        assertEquals(1, (result as Resource.Success).data.size)
    }

    // endregion

    // region markAsRead

    @Test
    fun `markAsRead returns Success`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/read", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.markAsRead("conv-1", "user-1", "msg-5")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region resetUnreadCount

    @Test
    fun `resetUnreadCount returns Success`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/reset-unread", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.resetUnreadCount("conv-1", "user-1")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region muteConversation

    @Test
    fun `muteConversation returns Success`() = runTest {
        coEvery { api.patch("/api/conversations/conv-1/settings", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.muteConversation("conv-1", "user-1", true)

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region pinConversation

    @Test
    fun `pinConversation returns Success`() = runTest {
        coEvery { api.patch("/api/conversations/conv-1/settings", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.pinConversation("conv-1", "user-1", true)

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region hideConversation

    @Test
    fun `hideConversation returns Success`() = runTest {
        coEvery { api.patch("/api/conversations/conv-1/settings", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.hideConversation("conv-1", "user-1")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region toggleReaction

    @Test
    fun `toggleReaction returns Success`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/messages/msg-1/react", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.toggleReaction("conv-1", "msg-1", "❤️", "user-1")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region recallMessage

    @Test
    fun `recallMessage returns Success`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/messages/msg-1/recall", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.recallMessage("conv-1", "msg-1")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region hideMessage

    @Test
    fun `hideMessage returns Success`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/messages/msg-1/hide", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.hideMessage("conv-1", "msg-1", "admin-1")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region createGroupConversation

    @Test
    fun `createGroupConversation returns Success`() = runTest {
        coEvery { api.post("/api/conversations/group", any()) } returns JSONObject().apply {
            put("id", "group-1")
            put("isGroup", true)
            put("groupName", "Test Group")
            put("createdAt", 1700000000000L)
            put("lastMessageAt", 1700000000000L)
        }

        val result = repo.createGroupConversation(
            creatorId = "user-1",
            participantIds = listOf("user-2", "user-3"),
            groupName = "Test Group"
        )

        assertTrue(result is Resource.Success)
        assertEquals("group-1", (result as Resource.Success).data.conversationId)
    }

    // endregion

    // region addGroupParticipant

    @Test
    fun `addGroupParticipant returns Success`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/participants/add", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.addGroupParticipant("conv-1", "user-new")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region removeGroupParticipant

    @Test
    fun `removeGroupParticipant returns Success`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/participants/remove", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.removeGroupParticipant("conv-1", "user-old")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region updateGroupName

    @Test
    fun `updateGroupName returns Success`() = runTest {
        coEvery { api.patch("/api/conversations/conv-1/group", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.updateGroupName("conv-1", "New Name")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region closeGroupConversation

    @Test
    fun `closeGroupConversation returns Success`() = runTest {
        coEvery { api.patch("/api/conversations/conv-1/close", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.closeGroupConversation("conv-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `closeGroupConversation returns Error on exception`() = runTest {
        coEvery { api.patch("/api/conversations/conv-1/close", any()) } throws RuntimeException("Fail")

        val result = repo.closeGroupConversation("conv-1")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region muteGroupMember

    @Test
    fun `muteGroupMember returns Success`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/mutes/user-bad", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.muteGroupMember("conv-1", "user-bad", 3600000L, "Spamming")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region unmuteGroupMember

    @Test
    fun `unmuteGroupMember returns Success`() = runTest {
        coEvery { api.delete("/api/conversations/conv-1/mutes/user-bad") } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.unmuteGroupMember("conv-1", "user-bad")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region updateGroupRoles

    @Test
    fun `updateGroupRoles returns Success`() = runTest {
        coEvery { api.patch("/api/conversations/conv-1/roles", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.updateGroupRoles("conv-1", listOf("admin-1"), listOf("mod-1"))

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region transferOwnership

    @Test
    fun `transferOwnership returns Success`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/transfer-ownership", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.transferOwnership("conv-1", "new-owner")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region getOwnedGroupCount

    @Test
    fun `getOwnedGroupCount returns Success with count`() = runTest {
        coEvery { api.get("/api/conversations/owned-group-count") } returns JSONObject().apply {
            put("count", 3)
        }

        val result = repo.getOwnedGroupCount("user-1")

        assertTrue(result is Resource.Success)
        assertEquals(3, (result as Resource.Success).data)
    }

    // endregion

    // region getModerationConfig

    @Test
    fun `getModerationConfig returns Success with word list`() = runTest {
        coEvery { api.get("/api/config/moderation") } returns JSONObject().apply {
            put("prohibitedWords", JSONArray().apply {
                put("badword1")
                put("badword2")
            })
        }

        val result = repo.getModerationConfig()

        assertTrue(result is Resource.Success)
        assertEquals(2, (result as Resource.Success).data.size)
    }

    // endregion

    // region sendStickerMessage

    @Test
    fun `sendStickerMessage returns Success`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/messages", any()) } returns JSONObject().apply {
            put("id", "msg-sticker")
        }

        val result = repo.sendStickerMessage("conv-1", "user-1", "Alice", "https://sticker.url")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region sendRoomInviteMessage

    @Test
    fun `sendRoomInviteMessage returns Success`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/messages", any()) } returns JSONObject().apply {
            put("id", "msg-invite")
        }

        val result = repo.sendRoomInviteMessage("conv-1", "user-1", "Alice", "room-1", "Fun Room")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region getConversation

    @Test
    fun `getConversation returns Success`() = runTest {
        coEvery { api.get("/api/conversations/conv-1") } returns JSONObject().apply {
            put("id", "conv-1")
            put("isGroup", false)
            put("createdAt", 1700000000000L)
        }

        val result = repo.getConversation("conv-1")

        assertTrue(result is Resource.Success)
        assertEquals("conv-1", (result as Resource.Success).data.conversationId)
    }

    @Test
    fun `getConversation returns Error on exception`() = runTest {
        coEvery { api.get("/api/conversations/conv-1") } throws RuntimeException("Fail")

        val result = repo.getConversation("conv-1")

        assertTrue(result is Resource.Error)
    }

    // endregion
}
