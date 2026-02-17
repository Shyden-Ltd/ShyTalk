package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.QuerySnapshot
import com.shyden.shytalk.core.util.Resource
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class MessageRepositoryImplTest {

    private lateinit var firestore: FirebaseFirestore
    private lateinit var roomsCollection: CollectionReference
    private lateinit var roomDoc: DocumentReference
    private lateinit var messagesCollection: CollectionReference
    private lateinit var messageDoc: DocumentReference
    private lateinit var repo: MessageRepositoryImpl

    @Before
    fun setup() {
        firestore = mockk(relaxed = true)
        roomsCollection = mockk(relaxed = true)
        roomDoc = mockk(relaxed = true)
        messagesCollection = mockk(relaxed = true)
        messageDoc = mockk(relaxed = true)

        every { firestore.collection("rooms") } returns roomsCollection
        every { roomsCollection.document(any<String>()) } returns roomDoc
        every { roomDoc.collection("messages") } returns messagesCollection
        every { messagesCollection.document(any<String>()) } returns messageDoc
        every { messageDoc.set(any()) } returns Tasks.forResult(null)

        // Mock trimOldMessages query (returns empty snapshot — no excess messages)
        val trimQuery = mockk<Query>(relaxed = true)
        val emptySnapshot = mockk<QuerySnapshot> { every { documents } returns emptyList() }
        every { messagesCollection.orderBy("createdAt", Query.Direction.ASCENDING) } returns trimQuery
        every { trimQuery.get() } returns Tasks.forResult(emptySnapshot)

        repo = MessageRepositoryImpl(firestore)
    }

    @Test
    fun `sendMessage returns Success and writes to correct path`() = runTest {
        val result = repo.sendMessage("room-1", "user-1", "Alice", "Hello!")

        assertTrue(result is Resource.Success)
        verify { roomsCollection.document("room-1") }
        verify { roomDoc.collection("messages") }
        val mapSlot = slot<Map<String, Any?>>()
        verify { messageDoc.set(capture(mapSlot)) }
        val data = mapSlot.captured
        assertTrue(data["senderId"] == "user-1")
        assertTrue(data["senderName"] == "Alice")
        assertTrue(data["text"] == "Hello!")
        assertTrue(data["type"] == "TEXT")
    }

    @Test
    fun `sendSystemMessage uses system sender`() = runTest {
        val result = repo.sendSystemMessage("room-1", "Room closed")

        assertTrue(result is Resource.Success)
        val mapSlot = slot<Map<String, Any?>>()
        verify { messageDoc.set(capture(mapSlot)) }
        val data = mapSlot.captured
        assertTrue(data["senderId"] == "system")
        assertTrue(data["senderName"] == "System")
        assertTrue(data["type"] == "SYSTEM")
    }

    @Test
    fun `sendJoinMessage uses JOIN type`() = runTest {
        val result = repo.sendJoinMessage("room-1", "user-2", "Bob", "Bob joined")

        assertTrue(result is Resource.Success)
        val mapSlot = slot<Map<String, Any?>>()
        verify { messageDoc.set(capture(mapSlot)) }
        val data = mapSlot.captured
        assertTrue(data["senderId"] == "user-2")
        assertTrue(data["type"] == "JOIN")
    }

    @Test
    fun `sendMessage returns Error on exception`() = runTest {
        every { messageDoc.set(any()) } returns Tasks.forException(RuntimeException("Write failed"))

        val result = repo.sendMessage("room-1", "user-1", "Alice", "Hello!")

        assertTrue(result is Resource.Error)
    }
}
