package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Task
import com.google.firebase.firestore.DocumentReference
import com.google.firebase.firestore.DocumentSnapshot
import com.google.firebase.firestore.FirebaseFirestore
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
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
        val mockSnapshot =
            mockk<DocumentSnapshot>(relaxed = true) {
                every { data } returns null
            }
        val mockGetTask =
            mockk<Task<DocumentSnapshot>>(relaxed = true) {
                every { isComplete } returns true
                every { isCanceled } returns false
                every { exception } returns null
                every { result } returns mockSnapshot
            }
        val mockVoidTask =
            mockk<Task<Void>>(relaxed = true) {
                every { isComplete } returns true
                every { isCanceled } returns false
                every { exception } returns null
                every { result } returns null
            }
        val mockDocRef =
            mockk<DocumentReference>(relaxed = true) {
                every { get() } returns mockGetTask
                every { update(any<String>(), any()) } returns mockVoidTask
                every { update(any<Map<String, Any?>>()) } returns mockVoidTask
                every { set(any()) } returns mockVoidTask
            }
        firestore =
            mockk(relaxed = true) {
                every { document(any()) } returns mockDocRef
            }

        repo = UserRepositoryImpl(api, firestore)
    }

    // region createOrUpdateUser

    @Test
    fun `createOrUpdateUser returns Success`() =
        runTest {
            coEvery { api.post(any(), any()) } returns JSONObject()

            val user =
                com.shyden.shytalk.core.model
                    .User(uid = "user-1", displayName = "Test")
            val result = repo.createOrUpdateUser(user)

            assertTrue(result is Resource.Success)
        }

    @Test
    fun `createOrUpdateUser returns Error on exception`() =
        runTest {
            coEvery { api.post(any(), any()) } throws RuntimeException("Network error")

            val user =
                com.shyden.shytalk.core.model
                    .User(uid = "user-1", displayName = "Test")
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
    fun `updateDisplayName returns Success`() =
        runTest {
            val result = repo.updateDisplayName("user-1", "New Name")

            assertTrue(result is Resource.Success)
        }

    @Test
    fun `updateAvatar returns Success`() =
        runTest {
            val result = repo.updateAvatar("user-1", "https://img.com/new.jpg")

            assertTrue(result is Resource.Success)
        }

    @Test
    fun `updateProfile returns Success`() =
        runTest {
            val fields = mapOf<String, Any?>("description" to "New desc", "nationality" to "UK")
            val result = repo.updateProfile("user-1", fields)

            assertTrue(result is Resource.Success)
        }

    // endregion

    // region blockUser / unblockUser / getBlockedUserIds

    @Test
    fun `blockUser returns Success`() =
        runTest {
            val result = repo.blockUser("user-1", "bad-user")

            assertTrue(result is Resource.Success)
        }

    @Test
    fun `unblockUser returns Success`() =
        runTest {
            val result = repo.unblockUser("user-1", "bad-user")

            assertTrue(result is Resource.Success)
        }

    // getBlockedUserIds — reads from Firestore (tested via integration tests)

    // endregion

    // region followUser / unfollowUser / removeFollower (via Worker API)

    @Test
    fun `followUser calls Worker API with correct path and body`() =
        runTest {
            val result = repo.followUser("user-1", "target-1")

            assertTrue(result is Resource.Success)
            coVerify {
                api.post(
                    "/api/users/user-1/follow",
                    match { it.getString("targetUserId") == "target-1" },
                )
            }
        }

    @Test
    fun `followUser returns Error on API failure`() =
        runTest {
            coEvery { api.post(any<String>(), any<JSONObject>()) } throws RuntimeException("API error")

            val result = repo.followUser("user-1", "target-1")

            assertTrue(result is Resource.Error)
        }

    @Test
    fun `unfollowUser calls Worker API with correct path and body`() =
        runTest {
            val result = repo.unfollowUser("user-1", "target-1")

            assertTrue(result is Resource.Success)
            coVerify {
                api.post(
                    "/api/users/user-1/unfollow",
                    match { it.getString("targetUserId") == "target-1" },
                )
            }
        }

    @Test
    fun `removeFollower calls Worker API with correct path and body`() =
        runTest {
            val result = repo.removeFollower("user-1", "follower-1")

            assertTrue(result is Resource.Success)
            coVerify {
                api.post(
                    "/api/users/user-1/remove-follower",
                    match { it.getString("followerUserId") == "follower-1" },
                )
            }
        }

    // endregion

    // region recordProfileVisit / markStalkersViewed (via Worker API)

    @Test
    fun `recordProfileVisit calls Worker API with correct path and body`() =
        runTest {
            val result = repo.recordProfileVisit("profile-1", "visitor-1")

            assertTrue(result is Resource.Success)
            coVerify {
                api.post(
                    "/api/users/profile-1/record-visit",
                    match { it.getString("visitorId") == "visitor-1" },
                )
            }
        }

    @Test
    fun `recordProfileVisit returns Error on failure`() =
        runTest {
            coEvery { api.post(any<String>(), any<JSONObject>()) } throws RuntimeException("API error")

            val result = repo.recordProfileVisit("user-1", "visitor-1")

            assertTrue(result is Resource.Error)
        }

    // getStalkers — reads from Firestore (tested via integration tests)

    @Test
    fun `markStalkersViewed returns Success`() =
        runTest {
            val result = repo.markStalkersViewed("user-1")

            assertTrue(result is Resource.Success)
        }

    // endregion

    // region aliases

    // getAliases — reads from Firestore (tested via integration tests)

    @Test
    fun `setAlias returns Success`() =
        runTest {
            val result = repo.setAlias("user-1", "target-1", "MyAlias")

            assertTrue(result is Resource.Success)
        }

    @Test
    fun `removeAlias returns Success`() =
        runTest {
            val result = repo.removeAlias("user-1", "target-1")

            assertTrue(result is Resource.Success)
        }

    // endregion

    // region suspension / warning

    @Test
    fun `submitSuspensionAppeal returns Success`() =
        runTest {
            coEvery { api.post(any(), any()) } returns JSONObject()

            val result = repo.submitSuspensionAppeal("user-1", "I'm innocent")

            assertTrue(result is Resource.Success)
        }

    @Test
    fun `liftExpiredSuspension returns Success`() =
        runTest {
            coEvery { api.post(any()) } returns JSONObject()

            val result = repo.liftExpiredSuspension("user-1")

            assertTrue(result is Resource.Success)
        }

    // region PM-lock auto-unlock (PR 11)

    @Test
    fun `checkPmLockOnLogin posts to pm-lock-check endpoint`() =
        runTest {
            // Route is server-only because Firestore rules deny client
            // writes to `pmLocked` / `lastPmLockCheck`. Body is empty —
            // the server identifies the user from the auth context.
            // Note: WorkerApiClient.post has a default JSONObject() body,
            // so calling `api.post(path)` actually invokes the 2-arg form
            // at runtime. coVerify matches the 2-arg form here; we pass
            // any() for the body because JSONObject lacks value equality.
            coEvery { api.post(any(), any<JSONObject>()) } returns JSONObject()

            val result = repo.checkPmLockOnLogin("user-1")

            assertTrue(result is Resource.Success)
            coVerify { api.post("/api/users/user-1/pm-lock-check", any<JSONObject>()) }
        }

    @Test
    fun `checkPmLockOnLogin returns Error on API failure`() =
        runTest {
            // Failure is non-fatal at the AuthViewModel call site (next
            // launch / counterparty surfaces state) but the repo MUST
            // surface an Error so unit-tests / future callers can react.
            coEvery { api.post(any(), any<JSONObject>()) } throws RuntimeException("Network error")

            val result = repo.checkPmLockOnLogin("user-1")

            assertTrue(result is Resource.Error)
        }

    // ── UK OSA #17 PR 2: forceTokenRefresh wire field ─────────────
    //
    // After a cohort flip the server includes `forceTokenRefresh:
    // true` in the response so the client knows to rotate its JWT
    // before the next Firestore read (otherwise the rules-layer is
    // stale until the ~1h auto-refresh window closes). Repository
    // parses the field and surfaces it in PmLockCheckResult so the
    // AuthViewModel caller can invoke AuthRepository.refreshIdToken.

    @Test
    fun `checkPmLockOnLogin parses forceTokenRefresh true from response`() =
        runTest {
            // Server response carries the flag — repo must surface
            // it in the data shape so the caller can react.
            val response =
                JSONObject()
                    .put("forceTokenRefresh", true)
                    .put("cohort", "adult")
                    .put("cohortChanged", true)
            coEvery { api.post(any(), any<JSONObject>()) } returns response

            val result = repo.checkPmLockOnLogin("user-1")

            assertTrue(result is Resource.Success)
            val data = (result as Resource.Success).data
            assertTrue("forceTokenRefresh must propagate from JSON", data.forceTokenRefresh)
            assertTrue("cohortChanged must propagate from JSON", data.cohortChanged)
            assertEquals("adult", data.cohort)
        }

    @Test
    fun `checkPmLockOnLogin defaults forceTokenRefresh false when field absent`() =
        runTest {
            // Backwards compat: a server that doesn't yet ship the
            // PR 2 changes returns the PR 1 payload shape. Repo
            // must default the missing field to `false` (do not
            // refresh) — safest fallback to avoid wasting Firebase
            // mint quota on a stale claim.
            coEvery { api.post(any(), any<JSONObject>()) } returns JSONObject()

            val result = repo.checkPmLockOnLogin("user-1")

            assertTrue(result is Resource.Success)
            val data = (result as Resource.Success).data
            assertFalse(data.forceTokenRefresh)
            assertFalse(data.cohortChanged)
        }

    // endregion

    @Test
    fun `acknowledgeWarning returns Success`() =
        runTest {
            val result = repo.acknowledgeWarning("user-1")

            assertTrue(result is Resource.Success)
        }

    // getWarningReason — reads from Firestore (tested via integration tests)

    // endregion

    // region generateUniqueId

    @Test
    fun `generateUniqueId returns unique id`() =
        runTest {
            coEvery { api.post(any(), any()) } returns JSONObject().put("uniqueId", 99887766L)

            val result = repo.generateUniqueId("user-1")

            assertTrue(result is Resource.Success)
            assertEquals(99887766L, (result as Resource.Success).data)
        }

    // endregion

    // region getUsers — reads from Firestore (tested via integration tests)

    @Test
    fun `getUsers returns empty list for empty input`() =
        runTest {
            val result = repo.getUsers(emptyList())

            assertTrue(result is Resource.Success)
            assertTrue((result as Resource.Success).data.isEmpty())
        }

    // endregion

    // region checkBlockedBy

    @Test
    fun `checkBlockedBy returns empty set for empty input`() =
        runTest {
            val result = repo.checkBlockedBy(emptyList(), "target-1")

            assertTrue(result is Resource.Success)
            assertTrue((result as Resource.Success).data.isEmpty())
        }

    // endregion
}
