package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.util.Resource
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class MessageRepositoryImplTest {

    private lateinit var firestore: FirebaseFirestore
    private lateinit var repo: MessageRepositoryImpl
    private lateinit var mockDocRef: DocumentReference
    private lateinit var mockCollRef: CollectionReference

    @Before
    fun setup() {
        firestore = mockk(relaxed = true)
        mockDocRef = mockk(relaxed = true)
        mockCollRef = mockk(relaxed = true)
        every { firestore.collection(any()) } returns mockCollRef
        every { mockCollRef.document() } returns mockDocRef
        every { mockDocRef.id } returns "generated-msg-id"
        every { firestore.document(any()) } returns mockDocRef
        every { mockDocRef.set(any()) } returns Tasks.forResult(null)
        every { mockDocRef.update(any<Map<String, Any>>()) } returns Tasks.forResult(null)
        repo = MessageRepositoryImpl(firestore)
    }

    // region sendMessage

    @Test
    fun `sendMessage returns Success`() = runTest {
        val result = repo.sendMessage("room-1", "user-1", "Alice", "Hello!")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `sendMessage returns Error on exception`() = runTest {
        every { mockDocRef.set(any()) } returns Tasks.forException(RuntimeException("Write failed"))

        val result = repo.sendMessage("room-1", "user-1", "Alice", "Hello!")
        assertTrue(result is Resource.Error)
    }

    // endregion

    // region sendSystemMessage

    @Test
    fun `sendSystemMessage returns Success`() = runTest {
        val result = repo.sendSystemMessage("room-1", "Room closed")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region sendJoinMessage

    @Test
    fun `sendJoinMessage returns Success`() = runTest {
        val result = repo.sendJoinMessage("room-1", "user-2", "Bob", "Bob joined")
        assertTrue(result is Resource.Success)
    }

    // endregion

    // region editMessage

    @Test
    fun `editMessage returns Success`() = runTest {
        val result = repo.editMessage("room-1", "msg-1", "Updated text")
        assertTrue(result is Resource.Success)
    }

    @Test
    fun `editMessage returns Error on exception`() = runTest {
        every { mockDocRef.update(any<Map<String, Any>>()) } returns Tasks.forException(RuntimeException("Fail"))

        val result = repo.editMessage("room-1", "msg-1", "Updated text")
        assertTrue(result is Resource.Error)
    }

    // endregion
}
