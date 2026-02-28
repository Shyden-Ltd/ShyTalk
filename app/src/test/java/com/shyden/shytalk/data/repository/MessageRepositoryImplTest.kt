package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class MessageRepositoryImplTest {

    private lateinit var api: WorkerApiClient
    private lateinit var presenceService: PresenceService
    private lateinit var repo: MessageRepositoryImpl

    @Before
    fun setup() {
        api = mockk(relaxed = true)
        presenceService = mockk(relaxed = true)
        repo = MessageRepositoryImpl(api, presenceService)
    }

    // region sendMessage

    @Test
    fun `sendMessage returns Success`() = runTest {
        coEvery { api.post("/api/rooms/room-1/messages", any()) } returns JSONObject().apply {
            put("messageId", "msg-1")
            put("senderId", "user-1")
            put("senderName", "Alice")
            put("text", "Hello!")
            put("type", "TEXT")
            put("createdAt", 1700000000000L)
        }

        val result = repo.sendMessage("room-1", "user-1", "Alice", "Hello!")

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/rooms/room-1/messages", any()) }
    }

    @Test
    fun `sendMessage returns Error on exception`() = runTest {
        coEvery { api.post("/api/rooms/room-1/messages", any()) } throws RuntimeException("Write failed")

        val result = repo.sendMessage("room-1", "user-1", "Alice", "Hello!")

        assertTrue(result is Resource.Error)
    }

    // endregion

    // region sendSystemMessage

    @Test
    fun `sendSystemMessage uses system sender`() = runTest {
        coEvery { api.post("/api/rooms/room-1/messages", any()) } returns JSONObject().apply {
            put("messageId", "msg-2")
            put("senderId", "system")
            put("senderName", "System")
            put("text", "Room closed")
            put("type", "SYSTEM")
            put("createdAt", 1700000000000L)
        }

        val result = repo.sendSystemMessage("room-1", "Room closed")

        assertTrue(result is Resource.Success)
        coVerify { api.post("/api/rooms/room-1/messages", any()) }
    }

    // endregion

    // region sendJoinMessage

    @Test
    fun `sendJoinMessage uses JOIN type`() = runTest {
        coEvery { api.post("/api/rooms/room-1/messages", any()) } returns JSONObject().apply {
            put("messageId", "msg-3")
            put("senderId", "user-2")
            put("senderName", "Bob")
            put("text", "Bob joined")
            put("type", "JOIN")
            put("createdAt", 1700000000000L)
        }

        val result = repo.sendJoinMessage("room-1", "user-2", "Bob", "Bob joined")

        assertTrue(result is Resource.Success)
    }

    // endregion

    // region editMessage

    @Test
    fun `editMessage returns Success`() = runTest {
        coEvery { api.patch("/api/rooms/room-1/messages/msg-1", any()) } returns JSONObject().apply {
            put("success", true)
        }

        val result = repo.editMessage("room-1", "msg-1", "Updated text")

        assertTrue(result is Resource.Success)
        coVerify { api.patch("/api/rooms/room-1/messages/msg-1", any()) }
    }

    @Test
    fun `editMessage returns Error on exception`() = runTest {
        coEvery { api.patch("/api/rooms/room-1/messages/msg-1", any()) } throws RuntimeException("Fail")

        val result = repo.editMessage("room-1", "msg-1", "Updated text")

        assertTrue(result is Resource.Error)
    }

    // endregion
}
