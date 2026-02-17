package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.Timestamp
import com.google.firebase.firestore.CollectionReference
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class UserRepositoryImplTest {

    private lateinit var firestore: FirebaseFirestore
    private lateinit var usersCollection: CollectionReference
    private lateinit var docRef: DocumentReference
    private lateinit var repo: UserRepositoryImpl

    @Before
    fun setup() {
        firestore = mockk(relaxed = true)
        usersCollection = mockk(relaxed = true)
        docRef = mockk(relaxed = true)
        every { firestore.collection("users") } returns usersCollection
        every { usersCollection.document(any<String>()) } returns docRef
        // Default get() to return non-existent doc so emitUserUpdate() completes quickly
        val emptySnapshot = mockk<DocumentSnapshot> {
            every { exists() } returns false
        }
        every { docRef.get() } returns Tasks.forResult(emptySnapshot)
        repo = UserRepositoryImpl(firestore)
    }

    @Test
    fun `createOrUpdateUser returns Success`() = runTest {
        val user = User(uid = "user-1", displayName = "Test")
        every { docRef.set(any()) } returns Tasks.forResult(null)

        val result = repo.createOrUpdateUser(user)

        assertTrue(result is Resource.Success)
        verify { usersCollection.document("user-1") }
    }

    @Test
    fun `createOrUpdateUser returns Error on exception`() = runTest {
        val user = User(uid = "user-1", displayName = "Test")
        every { docRef.set(any()) } returns Tasks.forException(RuntimeException("Firestore down"))

        val result = repo.createOrUpdateUser(user)

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `getUser returns Success with parsed user`() = runTest {
        val ts = Timestamp.now()
        val data = mapOf<String, Any?>(
            "displayName" to "Alice",
            "avatarUrl" to "https://img.com/a.jpg",
            "profilePhotoUrl" to null,
            "coverPhotoUrl" to null,
            "description" to "Hi",
            "nationality" to "US",
            "uniqueId" to 12345678L,
            "blockedUserIds" to listOf("blocked-1"),
            "email" to "a@b.com",
            "createdAt" to ts,
            "lastSeenAt" to ts
        )
        val snapshot = mockk<DocumentSnapshot> {
            every { exists() } returns true
            every { this@mockk.data } returns data
            every { id } returns "user-1"
        }
        every { docRef.get() } returns Tasks.forResult(snapshot)

        val result = repo.getUser("user-1")

        assertTrue(result is Resource.Success)
        val user = (result as Resource.Success).data
        assertEquals("user-1", user.uid)
        assertEquals("Alice", user.displayName)
        assertEquals("https://img.com/a.jpg", user.avatarUrl)
        assertEquals("Hi", user.description)
        assertEquals("US", user.nationality)
        assertEquals(12345678L, user.uniqueId)
        assertEquals(setOf("blocked-1"), user.blockedUserIds)
        assertEquals("a@b.com", user.email)
    }

    @Test
    fun `getUser returns Error when user not found`() = runTest {
        val snapshot = mockk<DocumentSnapshot> {
            every { exists() } returns false
        }
        every { docRef.get() } returns Tasks.forResult(snapshot)

        val result = repo.getUser("user-1")

        assertTrue(result is Resource.Error)
        assertEquals("User not found", (result as Resource.Error).message)
    }

    @Test
    fun `getUser returns Error when data is null`() = runTest {
        val snapshot = mockk<DocumentSnapshot> {
            every { exists() } returns true
            every { data } returns null
            every { id } returns "user-1"
        }
        every { docRef.get() } returns Tasks.forResult(snapshot)

        val result = repo.getUser("user-1")

        assertTrue(result is Resource.Error)
        assertEquals("User data is null", (result as Resource.Error).message)
    }

    @Test
    fun `getUser handles missing optional fields with defaults`() = runTest {
        val data = mapOf<String, Any?>()
        val snapshot = mockk<DocumentSnapshot> {
            every { exists() } returns true
            every { this@mockk.data } returns data
            every { id } returns "user-1"
        }
        every { docRef.get() } returns Tasks.forResult(snapshot)

        val result = repo.getUser("user-1")

        assertTrue(result is Resource.Success)
        val user = (result as Resource.Success).data
        assertEquals("", user.displayName)
        assertEquals(0L, user.uniqueId)
        assertEquals(emptySet<String>(), user.blockedUserIds)
    }

    @Test
    fun `userExists returns true when document exists`() = runTest {
        val snapshot = mockk<DocumentSnapshot> { every { exists() } returns true }
        every { docRef.get() } returns Tasks.forResult(snapshot)

        val result = repo.userExists("user-1")

        assertTrue(result is Resource.Success)
        assertTrue((result as Resource.Success).data)
    }

    @Test
    fun `userExists returns false when document does not exist`() = runTest {
        val snapshot = mockk<DocumentSnapshot> { every { exists() } returns false }
        every { docRef.get() } returns Tasks.forResult(snapshot)

        val result = repo.userExists("user-1")

        assertTrue(result is Resource.Success)
        assertFalse((result as Resource.Success).data)
    }

    @Test
    fun `updateDisplayName returns Success`() = runTest {
        every { docRef.update(any<String>(), any()) } returns Tasks.forResult(null)

        val result = repo.updateDisplayName("user-1", "New Name")

        assertTrue(result is Resource.Success)
        verify { docRef.update("displayName", "New Name") }
    }

    @Test
    fun `updateAvatar returns Success`() = runTest {
        every { docRef.update(any<String>(), any()) } returns Tasks.forResult(null)

        val result = repo.updateAvatar("user-1", "https://img.com/new.jpg")

        assertTrue(result is Resource.Success)
        verify { docRef.update("avatarUrl", "https://img.com/new.jpg") }
    }

    @Test
    fun `updateProfile returns Success`() = runTest {
        every { docRef.update(any<Map<String, Any?>>()) } returns Tasks.forResult(null)

        val fields = mapOf<String, Any?>("description" to "New desc", "nationality" to "UK")
        val result = repo.updateProfile("user-1", fields)

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `blockUser returns Success`() = runTest {
        val batch = mockk<com.google.firebase.firestore.WriteBatch>(relaxed = true)
        every { firestore.batch() } returns batch
        every { batch.update(any<DocumentReference>(), any<String>(), any()) } returns batch
        every { batch.commit() } returns Tasks.forResult(null)

        val result = repo.blockUser("user-1", "bad-user")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `unblockUser returns Success`() = runTest {
        every { docRef.update(any<String>(), any()) } returns Tasks.forResult(null)

        val result = repo.unblockUser("user-1", "bad-user")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `getBlockedUserIds returns list when doc exists`() = runTest {
        val data = mapOf<String, Any?>("blockedUserIds" to listOf("b1", "b2"))
        val snapshot = mockk<DocumentSnapshot> {
            every { exists() } returns true
            every { this@mockk.data } returns data
        }
        every { docRef.get() } returns Tasks.forResult(snapshot)

        val result = repo.getBlockedUserIds("user-1")

        assertTrue(result is Resource.Success)
        assertEquals(setOf("b1", "b2"), (result as Resource.Success).data)
    }

    @Test
    fun `getBlockedUserIds returns empty list when doc does not exist`() = runTest {
        val snapshot = mockk<DocumentSnapshot> { every { exists() } returns false }
        every { docRef.get() } returns Tasks.forResult(snapshot)

        val result = repo.getBlockedUserIds("user-1")

        assertTrue(result is Resource.Success)
        assertTrue((result as Resource.Success).data.isEmpty())
    }

    @Test
    fun `getBlockedUserIds returns empty list when field is missing`() = runTest {
        val data = mapOf<String, Any?>()
        val snapshot = mockk<DocumentSnapshot> {
            every { exists() } returns true
            every { this@mockk.data } returns data
        }
        every { docRef.get() } returns Tasks.forResult(snapshot)

        val result = repo.getBlockedUserIds("user-1")

        assertTrue(result is Resource.Success)
        assertTrue((result as Resource.Success).data.isEmpty())
    }
}
