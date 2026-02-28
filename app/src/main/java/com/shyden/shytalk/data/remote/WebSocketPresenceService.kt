package com.shyden.shytalk.data.remote

import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject
import java.util.concurrent.TimeUnit

/**
 * Presence service using WebSocket connections to the RoomDurableObject.
 *
 * Each user's WebSocket connection to the DO represents their presence.
 * The DO broadcasts presence changes to all connected clients.
 */
class WebSocketPresenceService(
    private val httpClient: OkHttpClient,
    private val baseUrl: String,
    private val auth: FirebaseAuth
) : PresenceService {
    companion object {
        private const val TAG = "WsPresenceService"
        private const val PING_INTERVAL_MS = 30_000L
        private const val RECONNECT_DELAY_MS = 3_000L
        private const val MAX_RECONNECT_ATTEMPTS = 5
    }

    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate)

    private var currentWebSocket: WebSocket? = null
    private var currentRoomId: String? = null
    private var currentUserId: String? = null
    private var reconnectAttempts = 0
    private var shouldReconnect = false

    /** Flow of presence user IDs for the currently connected room. */
    private val presenceFlow = MutableStateFlow<Set<String>>(emptySet())

    /** Shared flow for room events (room_updated, room_closed, kicked, etc.). */
    private val _roomEvents = MutableSharedFlow<RoomEvent>(extraBufferCapacity = 16)
    override val roomEvents: Flow<RoomEvent> = _roomEvents

    override fun setPresence(roomId: String, userId: String) {
        // Clean up previous connection if switching rooms
        if (currentRoomId != null && currentRoomId != roomId) {
            removePresence()
        }

        currentRoomId = roomId
        currentUserId = userId
        shouldReconnect = true
        reconnectAttempts = 0

        scope.launch { connectWebSocket(roomId, userId) }
        Log.d(TAG, "Presence set for room=$roomId user=$userId")
    }

    override fun removePresence() {
        shouldReconnect = false
        val roomId = currentRoomId
        val userId = currentUserId

        currentWebSocket?.close(1000, "Leaving room")
        currentWebSocket = null
        currentRoomId = null
        currentUserId = null
        presenceFlow.value = emptySet()
        reconnectAttempts = 0

        Log.d(TAG, "Presence removed for room=$roomId user=$userId")
    }

    override fun observeRoomPresence(roomId: String): Flow<Set<String>> {
        return presenceFlow.map { it }
    }

    private suspend fun connectWebSocket(roomId: String, userId: String) {
        val token = try {
            auth.currentUser?.getIdToken(false)?.await()?.token
                ?: throw IllegalStateException("Not signed in")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get auth token", e)
            scheduleReconnect(roomId, userId)
            return
        }

        val wsUrl = baseUrl
            .replace("https://", "wss://")
            .replace("http://", "ws://")

        val request = Request.Builder()
            .url("$wsUrl/api/rooms/$roomId/ws")
            .header("Authorization", "Bearer $token")
            .build()

        val wsClient = httpClient.newBuilder()
            .pingInterval(PING_INTERVAL_MS, TimeUnit.MILLISECONDS)
            .build()

        currentWebSocket = wsClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "WebSocket connected for room=$roomId")
                reconnectAttempts = 0
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                handleMessage(text)
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closing: code=$code reason=$reason")
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "WebSocket closed: code=$code reason=$reason")
                if (currentWebSocket === webSocket) {
                    currentWebSocket = null
                    presenceFlow.value = emptySet()
                    if (shouldReconnect) {
                        scope.launch { scheduleReconnect(roomId, userId) }
                    }
                }
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "WebSocket failure: ${t.message}")
                if (currentWebSocket === webSocket) {
                    currentWebSocket = null
                    presenceFlow.value = emptySet()
                    if (shouldReconnect) {
                        scope.launch { scheduleReconnect(roomId, userId) }
                    }
                }
            }
        })
    }

    private suspend fun scheduleReconnect(roomId: String, userId: String) {
        if (!shouldReconnect || reconnectAttempts >= MAX_RECONNECT_ATTEMPTS) {
            Log.w(TAG, "Giving up reconnection after $reconnectAttempts attempts")
            return
        }

        reconnectAttempts++
        val delayMs = RECONNECT_DELAY_MS * reconnectAttempts
        Log.d(TAG, "Reconnecting in ${delayMs}ms (attempt $reconnectAttempts)")
        delay(delayMs)

        if (shouldReconnect && currentRoomId == roomId) {
            connectWebSocket(roomId, userId)
        }
    }

    private fun handleMessage(text: String) {
        try {
            val json = JSONObject(text)
            when (json.optString("type")) {
                "pong" -> { /* keep-alive response, ignore */ }

                "presence" -> {
                    val userIdsArray = json.getJSONArray("userIds")
                    val userIds = (0 until userIdsArray.length())
                        .map { userIdsArray.getString(it) }
                        .toSet()
                    presenceFlow.value = userIds
                }

                "room_updated" -> {
                    _roomEvents.tryEmit(RoomEvent.RoomUpdated)
                }

                "new_message" -> {
                    _roomEvents.tryEmit(RoomEvent.NewMessage)
                }

                "seat_request_updated" -> {
                    _roomEvents.tryEmit(RoomEvent.SeatRequestUpdated)
                }

                "room_closed" -> {
                    shouldReconnect = false
                    _roomEvents.tryEmit(RoomEvent.RoomClosed)
                }

                "kicked" -> {
                    val userId = json.optString("userId")
                    if (userId == currentUserId) {
                        shouldReconnect = false
                    }
                    _roomEvents.tryEmit(RoomEvent.UserKicked(userId))
                }
            }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to parse WebSocket message: $text", e)
        }
    }
}
