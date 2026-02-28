package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONArray
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class UserRepositoryImplTest {

    private lateinit var api: WorkerApiClient
    private lateinit var repo: UserRepositoryImpl

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        repo = UserRepositoryImpl(api)
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

    // region getUser

    @Test
    fun `getUser returns Success with parsed user`() = runTest {
        val json = JSONObject().apply {
            put("displayName", "Alice")
            put("avatarUrl", "https://img.com/a.jpg")
            put("description", "Hi")
            put("nationality", "US")
            put("uniqueId", 12345678L)
            put("email", "a@b.com")
            put("blockedUserIds", JSONArray(listOf("blocked-1")))
            put("createdAt", System.currentTimeMillis())
            put("lastSeenAt", System.currentTimeMillis())
        }
        coEvery { api.get("/api/users/user-1") } returns json

        val result = repo.getUser("user-1")

        assertTrue(result is Resource.Success)
        val user = (result as Resource.Success).data
        assertEquals("user-1", user.uid)
        assertEquals("Alice", user.displayName)
        assertEquals("https://img.com/a.jpg", user.avatarUrl)
        assertEquals("Hi", user.description)
        assertEquals("US", user.nationality)
        assertEquals(12345678L, user.uniqueId)
        assertEquals("a@b.com", user.email)
    }

    @Test
    fun `getUser returns Error on exception`() = runTest {
        coEvery { api.get("/api/users/user-1") } throws RuntimeException("Server error")

        val result = repo.getUser("user-1")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region userExists

    @Test
    fun `userExists returns true when user exists`() = runTest {
        coEvery { api.get("/api/users/user-1/exists") } returns JSONObject().put("exists", true)

        val result = repo.userExists("user-1")

        assertTrue(result is Resource.Success)
        assertTrue((result as Resource.Success).data)
    }

    @Test
    fun `userExists returns false when user does not exist`() = runTest {
        coEvery { api.get("/api/users/user-1/exists") } returns JSONObject().put("exists", false)

        val result = repo.userExists("user-1")

        assertTrue(result is Resource.Success)
        assertFalse((result as Resource.Success).data)
    }

    // endregion

    // region updateDisplayName / updateAvatar / updateProfile

    @Test
    fun `updateDisplayName returns Success`() = runTest {
        coEvery { api.patch(any(), any()) } returns JSONObject()
        // emitUserUpdate re-fetches the user
        coEvery { api.get("/api/users/user-1") } returns JSONObject().put("displayName", "New Name")

        val result = repo.updateDisplayName("user-1", "New Name")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `updateAvatar returns Success`() = runTest {
        coEvery { api.patch(any(), any()) } returns JSONObject()
        coEvery { api.get("/api/users/user-1") } returns JSONObject().put("avatarUrl", "https://img.com/new.jpg")

        val result = repo.updateAvatar("user-1", "https://img.com/new.jpg")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `updateProfile returns Success`() = runTest {
        coEvery { api.patch(any(), any()) } returns JSONObject()
        coEvery { api.get("/api/users/user-1") } returns JSONObject().put("description", "New desc")

        val fields = mapOf<String, Any?>("description" to "New desc", "nationality" to "UK")
        val result = repo.updateProfile("user-1", fields)

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region blockUser / unblockUser / getBlockedUserIds

    @Test
    fun `blockUser returns Success`() = runTest {
        coEvery { api.post(any(), any()) } returns JSONObject()

        val result = repo.blockUser("user-1", "bad-user")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `unblockUser returns Success`() = runTest {
        coEvery { api.delete(any()) } returns JSONObject()

        val result = repo.unblockUser("user-1", "bad-user")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `getBlockedUserIds returns set of blocked ids`() = runTest {
        coEvery { api.get("/api/users/user-1/blocked") } returns JSONObject()
            .put("blockedUserIds", JSONArray(listOf("b1", "b2")))

        val result = repo.getBlockedUserIds("user-1")

        assertTrue(result is Resource.Success)
        assertEquals(setOf("b1", "b2"), (result as Resource.Success).data)
    }

    @Test
    fun `getBlockedUserIds returns empty set when array missing`() = runTest {
        coEvery { api.get("/api/users/user-1/blocked") } returns JSONObject()

        val result = repo.getBlockedUserIds("user-1")

        assertTrue(result is Resource.Success)
        assertTrue((result as Resource.Success).data.isEmpty())
    }

    // endregion

    // region followUser / unfollowUser / removeFollower

    @Test
    fun `followUser returns Success`() = runTest {
        coEvery { api.post(any(), any()) } returns JSONObject()

        val result = repo.followUser("user-1", "target-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `unfollowUser returns Success`() = runTest {
        coEvery { api.delete(any()) } returns JSONObject()

        val result = repo.unfollowUser("user-1", "target-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `removeFollower returns Success`() = runTest {
        coEvery { api.delete(any()) } returns JSONObject()

        val result = repo.removeFollower("user-1", "follower-1")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region recordProfileVisit / getStalkers / markStalkersViewed

    @Test
    fun `recordProfileVisit returns Success`() = runTest {
        coEvery { api.post(any(), any()) } returns JSONObject()

        val result = repo.recordProfileVisit("user-1", "visitor-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `recordProfileVisit returns Error on failure`() = runTest {
        coEvery { api.post(any(), any()) } throws RuntimeException("Network error")

        val result = repo.recordProfileVisit("user-1", "visitor-1")

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `getStalkers returns list of visitors`() = runTest {
        val stalkerJson = JSONObject().apply {
            put("visitorId", "visitor-1")
            put("lastVisitAt", System.currentTimeMillis())
            put("visitCount", 3)
        }
        coEvery { api.get("/api/users/user-1/stalkers") } returns JSONObject()
            .put("stalkers", JSONArray().put(stalkerJson))

        val result = repo.getStalkers("user-1")

        assertTrue(result is Resource.Success)
        assertEquals(1, (result as Resource.Success).data.size)
    }

    @Test
    fun `markStalkersViewed returns Success`() = runTest {
        coEvery { api.post(any()) } returns JSONObject()

        val result = repo.markStalkersViewed("user-1")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region aliases

    @Test
    fun `getAliases returns map of aliases`() = runTest {
        val aliases = JSONObject().apply {
            put("target-1", "Nickname1")
            put("target-2", "Nickname2")
        }
        coEvery { api.get("/api/users/user-1/aliases") } returns JSONObject().put("aliases", aliases)

        val result = repo.getAliases("user-1")

        assertTrue(result is Resource.Success)
        val data = (result as Resource.Success).data
        assertEquals("Nickname1", data["target-1"])
        assertEquals("Nickname2", data["target-2"])
    }

    @Test
    fun `setAlias returns Success`() = runTest {
        coEvery { api.put(any(), any()) } returns JSONObject()

        val result = repo.setAlias("user-1", "target-1", "MyAlias")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `removeAlias returns Success`() = runTest {
        coEvery { api.delete(any()) } returns JSONObject()

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
        coEvery { api.post(any()) } returns JSONObject()

        val result = repo.acknowledgeWarning("user-1")

        assertTrue(result is Resource.Success)
    }

    @Test
    fun `getWarningReason returns reason when present`() = runTest {
        coEvery { api.get("/api/users/user-1/warning-reason") } returns JSONObject().put("reason", "Spam")

        val result = repo.getWarningReason("user-1")

        assertTrue(result is Resource.Success)
        assertEquals("Spam", (result as Resource.Success).data)
    }

    @Test
    fun `getWarningReason returns null when no reason`() = runTest {
        coEvery { api.get("/api/users/user-1/warning-reason") } returns JSONObject()

        val result = repo.getWarningReason("user-1")

        assertTrue(result is Resource.Success)
        assertNull((result as Resource.Success).data)
    }

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

    // region getUsers (batch)

    @Test
    fun `getUsers returns list of users`() = runTest {
        val usersArray = JSONArray().apply {
            put(JSONObject().apply {
                put("uid", "u1")
                put("displayName", "User One")
            })
            put(JSONObject().apply {
                put("uid", "u2")
                put("displayName", "User Two")
            })
        }
        coEvery { api.post(any(), any()) } returns JSONObject().put("users", usersArray)

        val result = repo.getUsers(listOf("u1", "u2"))

        assertTrue(result is Resource.Success)
        assertEquals(2, (result as Resource.Success).data.size)
    }

    @Test
    fun `getUsers returns empty list for empty input`() = runTest {
        val result = repo.getUsers(emptyList())

        assertTrue(result is Resource.Success)
        assertTrue((result as Resource.Success).data.isEmpty())
    }

    // endregion
}
