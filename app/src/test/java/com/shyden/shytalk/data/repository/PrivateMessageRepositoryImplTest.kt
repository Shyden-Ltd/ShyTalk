package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.SetOptions
import com.google.firebase.firestore.WriteBatch
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class PrivateMessageRepositoryImplTest {

    private lateinit var api: WorkerApiClient
    private lateinit var firestore: FirebaseFirestore
    private lateinit var repo: PrivateMessageRepositoryImpl
    private lateinit var mockDocRef: DocumentReference
    private lateinit var mockCollRef: CollectionReference
    private lateinit var mockDocSnapshot: DocumentSnapshot
    private lateinit var mockBatch: WriteBatch

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        firestore = mockk(relaxed = true)
        mockDocRef = mockk(relaxed = true)
        mockCollRef = mockk(relaxed = true)
        mockDocSnapshot = mockk(relaxed = true)
        mockBatch = mockk(relaxed = true)

        // Firestore path resolution
        every { firestore.document(any()) } returns mockDocRef
        every { firestore.collection(any()) } returns mockCollRef
        every { mockCollRef.document() } returns mockDocRef
        every { mockCollRef.document(any<String>()) } returns mockDocRef
        every { mockDocRef.id } returns "test-id"
        every { mockDocRef.collection(any()) } returns mockCollRef

        // Task-returning operations
        every { mockDocRef.set(any()) } returns Tasks.forResult(null)
        every { mockDocRef.set(any(), any<SetOptions>()) } returns Tasks.forResult(null)
        every { mockDocRef.update(any<Map<String, Any>>()) } returns Tasks.forResult(null)
        every { mockDocRef.update(any<String>(), any()) } returns Tasks.forResult(null)
        every { mockDocRef.delete() } returns Tasks.forResult(null)
        every { mockDocRef.get() } returns Tasks.forResult(mockDocSnapshot)
        every { mockCollRef.add(any()) } returns Tasks.forResult(mockDocRef)

        // DocumentSnapshot defaults
        every { mockDocSnapshot.exists() } returns false
        every { mockDocSnapshot.data } returns mapOf("text" to "old text")
        every { mockDocSnapshot.getString(any()) } returns "old text"

        // Batch operations
        every { firestore.batch() } returns mockBatch
        every { mockBatch.commit() } returns Tasks.forResult(null)

        repo = PrivateMessageRepositoryImpl(api, firestore)
    }

    // region getOrCreateConversation — direct Firestore

    @Test
    fun `getOrCreateConversation returns Success when creating new`() = runTest {
        val result = repo.getOrCreateConversation("uid1", "uid2")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `getOrCreateConversation returns Success when existing`() = runTest {
        every { mockDocSnapshot.exists() } returns true
        every { mockDocSnapshot.data } returns mapOf(
            "participantIds" to listOf("uid1", "uid2"),
            "isGroup" to false,
            "createdAt" to 1700000000000L,
            "lastMessageAt" to 1700000000000L,
            "isClosed" to false
        )

        val result = repo.getOrCreateConversation("uid1", "uid2")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `getOrCreateConversation returns Error on exception`() = runTest {
        every { mockDocRef.get() } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.getOrCreateConversation("uid1", "uid2")
        assertTrue(result is Resource.Error)
    }

    // endregion

    // region sendTextMessage — Worker API (needs FCM push)

    @Test
    fun `sendTextMessage returns Success`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/messages", any()) } returns JSONObject().apply {
            put("id", "msg-1")
        }

        val result = repo.sendTextMessage("conv-1", "user-1", "Alice", "Hello!")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `sendTextMessage returns Error on exception`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/messages", any()) } throws RuntimeException("Fail")

        val result = repo.sendTextMessage("conv-1", "user-1", "Alice", "Hello!")
        assertTrue(result is Resource.Error)
    }

    // endregion

    // region sendImageMessage — Worker API

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

    // region sendStickerMessage — Worker API

    @Test
    fun `sendStickerMessage returns Success`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/messages", any()) } returns JSONObject().apply {
            put("id", "msg-sticker")
        }

        val result = repo.sendStickerMessage("conv-1", "user-1", "Alice", "https://sticker.url")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region sendRoomInviteMessage — Worker API

    @Test
    fun `sendRoomInviteMessage returns Success`() = runTest {
        coEvery { api.post("/api/conversations/conv-1/messages", any()) } returns JSONObject().apply {
            put("id", "msg-invite")
        }

        val result = repo.sendRoomInviteMessage("conv-1", "user-1", "Alice", "room-1", "Fun Room")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region editMessage — direct Firestore

    @Test
    fun `editMessage returns Success`() = runTest {
        val result = repo.editMessage("conv-1", "msg-1", "Updated text")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `editMessage returns Error on exception`() = runTest {
        every { mockDocRef.update(any<Map<String, Any>>()) } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.editMessage("conv-1", "msg-1", "Updated text")
        assertTrue(result is Resource.Error)
    }

    // endregion

    // region markAsRead — direct Firestore

    @Test
    fun `markAsRead returns Success`() = runTest {
        val result = repo.markAsRead("conv-1", "user-1", "msg-5")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region resetUnreadCount — direct Firestore

    @Test
    fun `resetUnreadCount returns Success`() = runTest {
        val result = repo.resetUnreadCount("conv-1", "user-1")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region muteConversation — direct Firestore

    @Test
    fun `muteConversation returns Success`() = runTest {
        val result = repo.muteConversation("conv-1", "user-1", true)
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region pinConversation — direct Firestore

    @Test
    fun `pinConversation returns Success`() = runTest {
        val result = repo.pinConversation("conv-1", "user-1", true)
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region hideConversation — direct Firestore

    @Test
    fun `hideConversation returns Success`() = runTest {
        val result = repo.hideConversation("conv-1", "user-1")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region toggleReaction — direct Firestore

    @Test
    fun `toggleReaction returns Success`() = runTest {
        val result = repo.toggleReaction("conv-1", "msg-1", "\u2764\uFE0F", "user-1")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region recallMessage — direct Firestore

    @Test
    fun `recallMessage returns Success`() = runTest {
        val result = repo.recallMessage("conv-1", "msg-1")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region hideMessage — direct Firestore

    @Test
    fun `hideMessage returns Success`() = runTest {
        val result = repo.hideMessage("conv-1", "msg-1", "admin-1")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region createGroupConversation — direct Firestore

    @Test
    fun `createGroupConversation returns Success`() = runTest {
        val result = repo.createGroupConversation(
            creatorId = "user-1",
            participantIds = listOf("user-2", "user-3"),
            groupName = "Test Group"
        )
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region addGroupParticipant — direct Firestore

    @Test
    fun `addGroupParticipant returns Success`() = runTest {
        val result = repo.addGroupParticipant("conv-1", "user-new")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region removeGroupParticipant — direct Firestore

    @Test
    fun `removeGroupParticipant returns Success`() = runTest {
        val result = repo.removeGroupParticipant("conv-1", "user-old")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region updateGroupName — direct Firestore

    @Test
    fun `updateGroupName returns Success`() = runTest {
        val result = repo.updateGroupName("conv-1", "New Name")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region closeGroupConversation — direct Firestore

    @Test
    fun `closeGroupConversation returns Success`() = runTest {
        val result = repo.closeGroupConversation("conv-1")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `closeGroupConversation returns Error on exception`() = runTest {
        every { mockDocRef.update(any<String>(), any()) } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.closeGroupConversation("conv-1")
        assertTrue(result is Resource.Error)
    }

    // endregion

    // region muteGroupMember — direct Firestore

    @Test
    fun `muteGroupMember returns Success`() = runTest {
        val result = repo.muteGroupMember("conv-1", "user-bad", 3600000L, "Spamming")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region unmuteGroupMember — direct Firestore

    @Test
    fun `unmuteGroupMember returns Success`() = runTest {
        val result = repo.unmuteGroupMember("conv-1", "user-bad")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region updateGroupRoles — direct Firestore

    @Test
    fun `updateGroupRoles returns Success`() = runTest {
        val result = repo.updateGroupRoles("conv-1", listOf("admin-1"), listOf("mod-1"))
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region transferOwnership — direct Firestore

    @Test
    fun `transferOwnership returns Success`() = runTest {
        val result = repo.transferOwnership("conv-1", "new-owner")
        assertTrue(result is Resource.Success)
    }

    // endregion
}
