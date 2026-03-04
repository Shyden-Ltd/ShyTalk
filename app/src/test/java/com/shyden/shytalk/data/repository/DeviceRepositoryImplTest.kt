package com.shyden.shytalk.data.repository

import android.os.SystemClock
import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.util.Resource
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class DeviceRepositoryImplTest {

    private lateinit var firestore: FirebaseFirestore
    private lateinit var repo: DeviceRepositoryImpl
    private lateinit var mockDocRef: DocumentReference

    @Before
    fun setup() {
        firestore = mockk(relaxed = true)
        mockDocRef = mockk(relaxed = true)
        every { firestore.document(any()) } returns mockDocRef
        repo = DeviceRepositoryImpl(firestore)
    }

    // region bindDevice

    @Test
    fun `bindDevice returns Success`() = runTest {
        every { mockDocRef.set(any()) } returns Tasks.forResult(null)

        val result = repo.bindDevice("device-1", "user-123")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `bindDevice returns Error on exception`() = runTest {
        every { mockDocRef.set(any()) } returns Tasks.forException(RuntimeException("Write failed"))

        val result = repo.bindDevice("device-1", "user-123")

        assertTrue(result is Resource.Error)
    }

    // endregion
}
