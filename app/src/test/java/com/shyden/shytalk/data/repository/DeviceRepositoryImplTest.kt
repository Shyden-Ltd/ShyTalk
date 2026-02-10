package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.util.Resource
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class DeviceRepositoryImplTest {

    private lateinit var firestore: FirebaseFirestore
    private lateinit var collection: CollectionReference
    private lateinit var docRef: DocumentReference
    private lateinit var repo: DeviceRepositoryImpl

    @Before
    fun setup() {
        firestore = mockk(relaxed = true)
        collection = mockk(relaxed = true)
        docRef = mockk(relaxed = true)
        every { firestore.collection("deviceBindings") } returns collection
        every { collection.document(any<String>()) } returns docRef
        repo = DeviceRepositoryImpl(firestore)
    }

    @Test
    fun `getDeviceBinding returns userId when document exists`() = runTest {
        val snapshot = mockk<DocumentSnapshot> {
            every { exists() } returns true
            every { getString("userId") } returns "user-123"
        }
        every { docRef.get() } returns Tasks.forResult(snapshot)

        val result = repo.getDeviceBinding("device-1")

        assertTrue(result is Resource.Success)
        assertEquals("user-123", (result as Resource.Success).data)
    }

    @Test
    fun `getDeviceBinding returns null when document does not exist`() = runTest {
        val snapshot = mockk<DocumentSnapshot> {
            every { exists() } returns false
        }
        every { docRef.get() } returns Tasks.forResult(snapshot)

        val result = repo.getDeviceBinding("device-1")

        assertTrue(result is Resource.Success)
        assertNull((result as Resource.Success).data)
    }

    @Test
    fun `getDeviceBinding returns Error on exception`() = runTest {
        every { docRef.get() } returns Tasks.forException(RuntimeException("Firestore error"))

        val result = repo.getDeviceBinding("device-1")

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `bindDevice returns Success`() = runTest {
        every { docRef.set(any()) } returns Tasks.forResult(null)

        val result = repo.bindDevice("device-1", "user-123")

        assertTrue(result is Resource.Success)
        verify { collection.document("device-1") }
    }

    @Test
    fun `bindDevice returns Error on exception`() = runTest {
        every { docRef.set(any()) } returns Tasks.forException(RuntimeException("Write failed"))

        val result = repo.bindDevice("device-1", "user-123")

        assertTrue(result is Resource.Error)
    }
}
