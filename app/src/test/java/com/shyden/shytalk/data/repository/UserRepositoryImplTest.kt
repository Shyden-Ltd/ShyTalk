package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Task
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class UserRepositoryImplTest {

    private lateinit var api: WorkerApiClient
    private lateinit var firestore: FirebaseFirestore
    private lateinit var repo: UserRepositoryImpl

    @Before
    fun setup() {
        api = mockk(relaxed = true)

        // Mock Firestore chain so Task.await() returns immediately
        // (isComplete=true prevents suspendCancellableCoroutine hang)
        val mockSnapshot = mockk<DocumentSnapshot>(relaxed = true) {
            every { data } returns null
        }
        val mockGetTask = mockk<Task<DocumentSnapshot>>(relaxed = true) {
            every { isComplete } returns true
            every { isCanceled } returns false
            every { exception } returns null
            every { result } returns mockSnapshot
        }
        val mockVoidTask = mockk<Task<Void>>(relaxed = true) {
            every { isComplete } returns true
            every { isCanceled } returns false
            every { exception } returns null
            every { result } returns null
        }
        val mockDocRef = mockk<DocumentReference>(relaxed = true) {
            every { get() } returns mockGetTask
            every { update(any<String>(), any()) } returns mockVoidTask
            every { update(any<Map<String, Any?>>()) } returns mockVoidTask
            every { set(any()) } returns mockVoidTask
        }
        firestore = mockk(relaxed = true) {
            every { document(any()) } returns mockDocRef
        }

        repo = UserRepositoryImpl(api, firestore)
    }

    // region createOrUpdateUser

    @Test
    fun `createOrUpdateUser returns Success`() = runTest {
        coEvery { api.post(any(), any()) } returns JSONObject()

        val user = com.shyden.shytalk.core.model.User(uid = "user-1", displayName = "Test")
        val result = repo.createOrUpdateUser(user)

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `createOrUpdateUser returns Error on exception`() = runTest {
        coEvery { api.post(any(), any()) } throws RuntimeException("Network error")

        val user = com.shyden.shytalk.core.model.User(uid = "user-1", displayName = "Test")
        val result = repo.createOrUpdateUser(user)

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region getUser — reads from Firestore (tested via integration tests)

    // endregion

    // region userExists — reads from Firestore (tested via integration tests)

    // endregion

    // region updateDisplayName / updateAvatar / updateProfile

    @Test
    fun `updateDisplayName returns Success`() = runTest {
        val result = repo.updateDisplayName("user-1", "New Name")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `updateAvatar returns Success`() = runTest {
        val result = repo.updateAvatar("user-1", "https://img.com/new.jpg")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `updateProfile returns Success`() = runTest {
        val fields = mapOf<String, Any?>("description" to "New desc", "nationality" to "UK")
        val result = repo.updateProfile("user-1", fields)

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region blockUser / unblockUser / getBlockedUserIds

    @Test
    fun `blockUser returns Success`() = runTest {
        val result = repo.blockUser("user-1", "bad-user")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `unblockUser returns Success`() = runTest {
        val result = repo.unblockUser("user-1", "bad-user")

        assertTrue(result is Resource.Success)
    }

    // getBlockedUserIds — reads from Firestore (tested via integration tests)

    // endregion

    // region followUser / unfollowUser / removeFollower

    @Test
    fun `followUser returns Success`() = runTest {
        val result = repo.followUser("user-1", "target-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `unfollowUser returns Success`() = runTest {
        val result = repo.unfollowUser("user-1", "target-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `removeFollower returns Success`() = runTest {
        val result = repo.removeFollower("user-1", "follower-1")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region recordProfileVisit / markStalkersViewed

    @Test
    fun `recordProfileVisit returns Success`() = runTest {
        val result = repo.recordProfileVisit("user-1", "visitor-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `recordProfileVisit returns Error on failure`() = runTest {
        val notFoundSnapshot = mockk<DocumentSnapshot>(relaxed = true) {
            every { exists() } returns false
        }
        val getTask = mockk<Task<DocumentSnapshot>>(relaxed = true) {
            every { isComplete } returns true
            every { isCanceled } returns false
            every { exception } returns null
            every { result } returns notFoundSnapshot
        }
        val failTask = mockk<Task<Void>>(relaxed = true) {
            every { isComplete } returns true
            every { isCanceled } returns false
            every { exception } returns RuntimeException("Firestore error")
            every { result } throws RuntimeException("Firestore error")
        }
        val failDocRef = mockk<DocumentReference>(relaxed = true) {
            every { get() } returns getTask
            every { set(any()) } returns failTask
        }
        every { firestore.document("users/user-1/stalkers/visitor-1") } returns failDocRef

        val result = repo.recordProfileVisit("user-1", "visitor-1")

        assertTrue(result is Resource.Error)
    }

    // getStalkers — reads from Firestore (tested via integration tests)

    @Test
    fun `markStalkersViewed returns Success`() = runTest {
        val result = repo.markStalkersViewed("user-1")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region aliases

    // getAliases — reads from Firestore (tested via integration tests)

    @Test
    fun `setAlias returns Success`() = runTest {
        val result = repo.setAlias("user-1", "target-1", "MyAlias")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `removeAlias returns Success`() = runTest {
        val result = repo.removeAlias("user-1", "target-1")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region suspension / warning

    @Test
    fun `submitSuspensionAppeal returns Success`() = runTest {
        coEvery { api.post(any(), any()) } returns JSONObject()

        val result = repo.submitSuspensionAppeal("user-1", "I'm innocent")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `liftExpiredSuspension returns Success`() = runTest {
        coEvery { api.post(any()) } returns JSONObject()

        val result = repo.liftExpiredSuspension("user-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `acknowledgeWarning returns Success`() = runTest {
        val result = repo.acknowledgeWarning("user-1")

        assertTrue(result is Resource.Success)
    }

    // getWarningReason — reads from Firestore (tested via integration tests)

    // endregion

    // region generateUniqueId

    @Test
    fun `generateUniqueId returns unique id`() = runTest {
        coEvery { api.post(any(), any()) } returns JSONObject().put("uniqueId", 99887766L)

        val result = repo.generateUniqueId("user-1")

        assertTrue(result is Resource.Success)
        assertEquals(99887766L, (result as Resource.Success).data)
    }

    // endregion

    // region getUsers — reads from Firestore (tested via integration tests)

    @Test
    fun `getUsers returns empty list for empty input`() = runTest {
        val result = repo.getUsers(emptyList())

        assertTrue(result is Resource.Success)
        assertTrue((result as Resource.Success).data.isEmpty())
    }

    // endregion
}
