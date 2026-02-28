package com.shyden.shytalk.data.remote

import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GetTokenResult
import io.mockk.every
import io.mockk.mockk
import io.mockk.slot
import io.mockk.verify
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.first
import kotlinx.coroutines.launch
import kotlinx.coroutines.test.UnconfinedTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONArray
import org.json.JSONObject
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.util.concurrent.TimeUnit

@OptIn(ExperimentalCoroutinesApi::class)
class PresenceServiceTest {

    private val testDispatcher = UnconfinedTestDispatcher()
    private lateinit var httpClient: OkHttpClient
    private lateinit var auth: FirebaseAuth
    private lateinit var presenceService: WebSocketPresenceService
    private lateinit var mockWebSocket: WebSocket
    private lateinit var capturedListener: WebSocketListener
    private lateinit var wsBuilder: OkHttpClient

    @Before
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        mockWebSocket = mockk(relaxed = true)

        // Capture the WebSocketListener when newWebSocket is called
        val listenerSlot = slot<WebSocketListener>()
        wsBuilder = mockk(relaxed = true) {
            every { newWebSocket(any(), capture(listenerSlot)) } answers {
                capturedListener = listenerSlot.captured
                mockWebSocket
            }
        }
        val builder = mockk<OkHttpClient.Builder>(relaxed = true) {
            every { pingInterval(any<Long>(), any<TimeUnit>()) } returns this@mockk
            every { build() } returns wsBuilder
        }
        httpClient = mockk(relaxed = true) {
            every { newBuilder() } returns builder
        }

        // Mock Firebase Auth to return a token
        val tokenResult = mockk<GetTokenResult> { every { token } returns "test-token" }
        val user = mockk<FirebaseUser> {
            every { getIdToken(any()) } returns Tasks.forResult(tokenResult)
        }
        auth = mockk { every { currentUser } returns user }

        presenceService = WebSocketPresenceService(httpClient, "https://api.example.com", auth)
    }

    @After
    fun tearDown() {
        presenceService.removePresence()
        Dispatchers.resetMain()
    }

    @Test
    fun `setPresence opens WebSocket connection`() = runTest {
        presenceService.setPresence("room-1", "user-1")
        advanceUntilIdle()

        verify { wsBuilder.newWebSocket(any(), any()) }
    }

    @Test
    fun `setPresence uses correct WebSocket URL`() = runTest {
        val requestSlot = slot<Request>()
        every { wsBuilder.newWebSocket(capture(requestSlot), any()) } returns mockWebSocket

        presenceService.setPresence("room-1", "user-1")
        advanceUntilIdle()

        val url = requestSlot.captured.url.toString()
        // OkHttp normalizes wss:// to https:// internally
        assertTrue("URL should contain room ID path", url.contains("/api/rooms/room-1/ws"))
    }

    @Test
    fun `setPresence sets Authorization header`() = runTest {
        val requestSlot = slot<Request>()
        every { wsBuilder.newWebSocket(capture(requestSlot), any()) } returns mockWebSocket

        presenceService.setPresence("room-1", "user-1")
        advanceUntilIdle()

        assertEquals("Bearer test-token", requestSlot.captured.header("Authorization"))
    }

    @Test
    fun `removePresence closes WebSocket`() = runTest {
        presenceService.setPresence("room-1", "user-1")
        advanceUntilIdle()

        presenceService.removePresence()

        verify { mockWebSocket.close(1000, "Leaving room") }
    }

    @Test
    fun `removePresence is no-op when not in room`() {
        presenceService.removePresence()

        verify(exactly = 0) { mockWebSocket.close(any(), any()) }
    }

    @Test
    fun `setPresence cleans up previous room when switching`() = runTest {
        val mockWs1 = mockk<WebSocket>(relaxed = true)
        val mockWs2 = mockk<WebSocket>(relaxed = true)
        var callCount = 0
        every { wsBuilder.newWebSocket(any(), any()) } answers {
            callCount++
            if (callCount == 1) mockWs1 else mockWs2
        }

        presenceService.setPresence("room-1", "user-1")
        advanceUntilIdle()

        presenceService.setPresence("room-2", "user-1")
        advanceUntilIdle()

        // First WebSocket should have been closed
        verify { mockWs1.close(1000, "Leaving room") }
        // Second WebSocket should have been opened
        assertEquals(2, callCount)
    }

    @Test
    fun `observeRoomPresence emits presence updates from WebSocket`() = runTest {
        presenceService.setPresence("room-1", "user-1")
        advanceUntilIdle()

        var emittedUsers: Set<String>? = null
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            presenceService.observeRoomPresence("room-1").first { users ->
                emittedUsers = users
                users.isNotEmpty()
            }
        }

        // Simulate presence message from DO
        val presenceMsg = JSONObject().apply {
            put("type", "presence")
            put("userIds", JSONArray(listOf("user-1", "user-2")))
        }
        capturedListener.onMessage(mockWebSocket, presenceMsg.toString())

        assertEquals(setOf("user-1", "user-2"), emittedUsers)
        job.cancel()
    }

    @Test
    fun `observeRoomPresence emits empty set when no users`() = runTest {
        presenceService.setPresence("room-1", "user-1")
        advanceUntilIdle()

        var emittedUsers: Set<String>? = null
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            presenceService.observeRoomPresence("room-1").first { users ->
                emittedUsers = users
                true
            }
        }

        val presenceMsg = JSONObject().apply {
            put("type", "presence")
            put("userIds", JSONArray())
        }
        capturedListener.onMessage(mockWebSocket, presenceMsg.toString())

        assertTrue(emittedUsers!!.isEmpty())
        job.cancel()
    }

    @Test
    fun `removePresence clears presence flow`() = runTest {
        presenceService.setPresence("room-1", "user-1")
        advanceUntilIdle()

        // Simulate presence
        val presenceMsg = JSONObject().apply {
            put("type", "presence")
            put("userIds", JSONArray(listOf("user-1")))
        }
        capturedListener.onMessage(mockWebSocket, presenceMsg.toString())

        // Remove presence — flow should emit empty set
        presenceService.removePresence()

        val current = presenceService.observeRoomPresence("room-1").first()
        assertTrue(current.isEmpty())
    }

    @Test
    fun `roomEvents emits RoomClosed on room_closed message`() = runTest {
        presenceService.setPresence("room-1", "user-1")
        advanceUntilIdle()

        var event: RoomEvent? = null
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            presenceService.roomEvents.first { e ->
                event = e
                true
            }
        }

        capturedListener.onMessage(
            mockWebSocket,
            JSONObject().apply { put("type", "room_closed") }.toString()
        )

        assertEquals(RoomEvent.RoomClosed, event)
        job.cancel()
    }

    @Test
    fun `roomEvents emits UserKicked on kicked message`() = runTest {
        presenceService.setPresence("room-1", "user-1")
        advanceUntilIdle()

        var event: RoomEvent? = null
        val job = launch(UnconfinedTestDispatcher(testScheduler)) {
            presenceService.roomEvents.first { e ->
                event = e
                true
            }
        }

        capturedListener.onMessage(
            mockWebSocket,
            JSONObject().apply {
                put("type", "kicked")
                put("userId", "user-1")
            }.toString()
        )

        assertTrue(event is RoomEvent.UserKicked)
        assertEquals("user-1", (event as RoomEvent.UserKicked).userId)
        job.cancel()
    }
}
