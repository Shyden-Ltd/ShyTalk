package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import com.google.firebase.firestore.WriteBatch
import com.shyden.shytalk.core.util.Resource
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class PrivateMessageRepositoryImplTest {

    private lateinit var firestore: FirebaseFirestore
    private lateinit var conversationsCollection: CollectionReference
    private lateinit var repo: PrivateMessageRepositoryImpl

    // Reusable mocks
    private lateinit var convDoc: DocumentReference
    private lateinit var settingsCollection: CollectionReference
    private lateinit var messagesCollection: CollectionReference
    private lateinit var batch: WriteBatch

    @Before
    fun setup() {
        firestore = mockk(relaxed = true)
        conversationsCollection = mockk(relaxed = true)
        convDoc = mockk(relaxed = true)
        settingsCollection = mockk(relaxed = true)
        messagesCollection = mockk(relaxed = true)
        batch = mockk(relaxed = true)

        every { firestore.collection("conversations") } returns conversationsCollection
        every { conversationsCollection.document(any<String>()) } returns convDoc
        every { convDoc.collection("settings") } returns settingsCollection
        every { convDoc.collection("messages") } returns messagesCollection
        every { firestore.batch() } returns batch
        every { batch.commit() } returns Tasks.forResult(null)

        repo = PrivateMessageRepositoryImpl(firestore)
    }

    @Test
    fun `getOrCreateConversation returns existing conversation`() = runTest {
        val existingData = mapOf(
            "participantIds" to listOf("alice", "bob"),
            "lastMessageAt" to 1000L,
            "createdAt" to 500L,
            "isGroup" to false
        )
        val snapshot = mockk<DocumentSnapshot>()
        every { snapshot.exists() } returns true
        every { snapshot.data } returns existingData
        every { snapshot.id } returns "alice_bob"
        // The conversation ID is generated deterministically
        every { conversationsCollection.document(any<String>()) } returns convDoc
        every { convDoc.get() } returns Tasks.forResult(snapshot)

        val result = repo.getOrCreateConversation("alice", "bob")

        assertTrue(result is Resource.Success)
        val conv = (result as Resource.Success).data
        assertEquals(2, conv.participantIds.size)
    }

    @Test
    fun `getOrCreateConversation creates new when none exists`() = runTest {
        val snapshot = mockk<DocumentSnapshot>()
        every { snapshot.exists() } returns false
        every { convDoc.get() } returns Tasks.forResult(snapshot)
        every { convDoc.set(any<Map<String, Any?>>()) } returns Tasks.forResult(null)

        val settingsDoc1 = mockk<DocumentReference>(relaxed = true)
        val settingsDoc2 = mockk<DocumentReference>(relaxed = true)
        every { settingsCollection.document("alice") } returns settingsDoc1
        every { settingsCollection.document("bob") } returns settingsDoc2
        every { settingsDoc1.set(any<Map<String, Any?>>()) } returns Tasks.forResult(null)
        every { settingsDoc2.set(any<Map<String, Any?>>()) } returns Tasks.forResult(null)

        val result = repo.getOrCreateConversation("alice", "bob")

        assertTrue(result is Resource.Success)
        verify { convDoc.set(any<Map<String, Any?>>()) }
    }

    @Test
    fun `getConversationSettings returns settings when doc exists`() = runTest {
        val settingsDoc = mockk<DocumentReference>(relaxed = true)
        every { settingsCollection.document("user-1") } returns settingsDoc
        val snapshot = mockk<DocumentSnapshot>()
        every { snapshot.exists() } returns true
        every { snapshot.data } returns mapOf(
            "isMuted" to true,
            "isPinned" to false,
            "isHidden" to false,
            "unreadCount" to 5L
        )
        every { settingsDoc.get() } returns Tasks.forResult(snapshot)

        val result = repo.getConversationSettings("conv-1", "user-1")

        assertTrue(result is Resource.Success)
        val settings = (result as Resource.Success).data
        assertTrue(settings.isMuted)
        assertEquals(5L, settings.unreadCount)
    }

    @Test
    fun `getConversationSettings returns defaults when doc not found`() = runTest {
        val settingsDoc = mockk<DocumentReference>(relaxed = true)
        every { settingsCollection.document("user-1") } returns settingsDoc
        val snapshot = mockk<DocumentSnapshot>()
        every { snapshot.exists() } returns false
        every { settingsDoc.get() } returns Tasks.forResult(snapshot)

        val result = repo.getConversationSettings("conv-1", "user-1")

        assertTrue(result is Resource.Success)
        val settings = (result as Resource.Success).data
        assertEquals("user-1", settings.userId)
        assertEquals(false, settings.isMuted)
        assertEquals(0L, settings.unreadCount)
    }

    @Test
    fun `sendTextMessage writes message and updates preview`() = runTest {
        val messageDoc = mockk<DocumentReference>(relaxed = true)
        every { messagesCollection.document(any<String>()) } returns messageDoc

        val result = repo.sendTextMessage("conv-1", "user-1", "Alice", "Hello!")

        assertTrue(result is Resource.Success)
        verify { batch.set(messageDoc, any<Map<String, Any?>>()) }
        verify { batch.update(convDoc, any<Map<String, Any>>()) }
        verify { batch.commit() }
    }

    @Test
    fun `sendTextMessage returns Error on exception`() = runTest {
        val messageDoc = mockk<DocumentReference>(relaxed = true)
        every { messagesCollection.document(any<String>()) } returns messageDoc
        every { batch.commit() } returns Tasks.forException(RuntimeException("Commit failed"))

        val result = repo.sendTextMessage("conv-1", "user-1", "Alice", "Hello!")

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `markAsRead updates readBy and settings`() = runTest {
        val messageDoc = mockk<DocumentReference>(relaxed = true)
        every { messagesCollection.document("msg-1") } returns messageDoc
        every { messageDoc.update(any<String>(), any()) } returns Tasks.forResult(null)

        val settingsDoc = mockk<DocumentReference>(relaxed = true)
        every { settingsCollection.document("user-1") } returns settingsDoc

        val result = repo.markAsRead("conv-1", "user-1", "msg-1")

        assertTrue(result is Resource.Success)
        verify { batch.update(messageDoc, eq("readBy"), any()) }
        verify { batch.update(settingsDoc, any<Map<String, Any>>()) }
    }

    @Test
    fun `muteConversation updates isMuted`() = runTest {
        val settingsDoc = mockk<DocumentReference>(relaxed = true)
        every { settingsCollection.document("user-1") } returns settingsDoc
        every { settingsDoc.update("isMuted", true) } returns Tasks.forResult(null)

        val result = repo.muteConversation("conv-1", "user-1", true)

        assertTrue(result is Resource.Success)
        verify { settingsDoc.update("isMuted", true) }
    }

    @Test
    fun `recallMessage sets isRecalled`() = runTest {
        val messageDoc = mockk<DocumentReference>(relaxed = true)
        every { messagesCollection.document("msg-1") } returns messageDoc
        every { messageDoc.update("isRecalled", true) } returns Tasks.forResult(null)
        every { convDoc.update(any<String>(), any()) } returns Tasks.forResult(null)

        val result = repo.recallMessage("conv-1", "msg-1")

        assertTrue(result is Resource.Success)
        verify { messageDoc.update("isRecalled", true) }
    }

    @Test
    fun `getOwnedGroupCount returns count`() = runTest {
        val query1 = mockk<Query>(relaxed = true)
        val query2 = mockk<Query>(relaxed = true)
        val query3 = mockk<Query>(relaxed = true)
        val snapshot = mockk<QuerySnapshot>()

        every { conversationsCollection.whereEqualTo("createdBy", "user-1") } returns query1
        every { query1.whereEqualTo("isGroup", true) } returns query2
        every { query2.whereEqualTo("isClosed", false) } returns query3
        every { query3.get() } returns Tasks.forResult(snapshot)
        every { snapshot.size() } returns 3

        val result = repo.getOwnedGroupCount("user-1")

        assertTrue(result is Resource.Success)
        assertEquals(3, (result as Resource.Success).data)
    }
}
