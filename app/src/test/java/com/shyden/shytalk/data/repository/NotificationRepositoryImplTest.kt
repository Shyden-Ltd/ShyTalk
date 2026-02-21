package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.util.Resource
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class NotificationRepositoryImplTest {

    private lateinit var firestore: FirebaseFirestore
    private lateinit var usersCollection: CollectionReference
    private lateinit var userDoc: DocumentReference
    private lateinit var repo: NotificationRepositoryImpl

    @Before
    fun setup() {
        firestore = mockk(relaxed = true)
        usersCollection = mockk(relaxed = true)
        userDoc = mockk(relaxed = true)

        every { firestore.collection("users") } returns usersCollection
        every { usersCollection.document(any<String>()) } returns userDoc

        repo = NotificationRepositoryImpl(firestore)
    }

    @Test
    fun `saveFcmToken returns Success`() = runTest {
        every { userDoc.update(eq("fcmTokens"), any()) } returns Tasks.forResult(null)

        val result = repo.saveFcmToken("user-1", "token-abc")

        assertTrue(result is Resource.Success)
        verify { usersCollection.document("user-1") }
    }

    @Test
    fun `saveFcmToken returns Error on exception`() = runTest {
        every { userDoc.update(eq("fcmTokens"), any()) } returns Tasks.forException(RuntimeException("Write failed"))

        val result = repo.saveFcmToken("user-1", "token-abc")

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `removeFcmToken returns Success`() = runTest {
        every { userDoc.update(eq("fcmTokens"), any()) } returns Tasks.forResult(null)

        val result = repo.removeFcmToken("user-1", "token-abc")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `removeFcmToken returns Error on exception`() = runTest {
        every { userDoc.update(eq("fcmTokens"), any()) } returns Tasks.forException(RuntimeException("Write failed"))

        val result = repo.removeFcmToken("user-1", "token-abc")

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `setPmNotificationsEnabled returns Success`() = runTest {
        every { userDoc.update("pmNotificationsEnabled", true) } returns Tasks.forResult(null)

        val result = repo.setPmNotificationsEnabled("user-1", true)

        assertTrue(result is Resource.Success)
        verify { userDoc.update("pmNotificationsEnabled", true) }
    }

    @Test
    fun `getPmNotificationsEnabled returns true by default`() = runTest {
        val snapshot = mockk<DocumentSnapshot>()
        every { snapshot.getBoolean("pmNotificationsEnabled") } returns null
        every { userDoc.get() } returns Tasks.forResult(snapshot)

        val result = repo.getPmNotificationsEnabled("user-1")

        assertTrue(result is Resource.Success)
        assertEquals(true, (result as Resource.Success).data)
    }

    @Test
    fun `getPmNotificationsEnabled returns stored value`() = runTest {
        val snapshot = mockk<DocumentSnapshot>()
        every { snapshot.getBoolean("pmNotificationsEnabled") } returns false
        every { userDoc.get() } returns Tasks.forResult(snapshot)

        val result = repo.getPmNotificationsEnabled("user-1")

        assertTrue(result is Resource.Success)
        assertEquals(false, (result as Resource.Success).data)
    }
}
