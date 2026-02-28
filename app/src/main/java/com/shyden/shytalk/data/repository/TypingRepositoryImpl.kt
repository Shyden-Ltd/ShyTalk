package com.shyden.shytalk.data.repository

import android.util.Log
import com.google.firebase.auth.FirebaseAuth
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.Response
import okhttp3.WebSocket
import okhttp3.WebSocketListener
import org.json.JSONObject

class TypingRepositoryImpl(
    private val httpClient: OkHttpClient,
    private val baseUrl: String,
    private val auth: FirebaseAuth
) : TypingRepository {

    companion object {
        private const val TAG = "TypingRepo"
    }

    /** Active WebSocket for the current conversation. */
    @Volatile
    private var activeWebSocket: WebSocket? = null
    @Volatile
    private var activeConversationId: String? = null

    override fun setTyping(conversationId: String, userId: String, isTyping: Boolean) {
        val ws = activeWebSocket ?: return
        if (activeConversationId != conversationId) return

        val msg = JSONObject().apply {
            put("type", if (isTyping) "typing_start" else "typing_stop")
        }
        try {
            ws.send(msg.toString())
        } catch (e: Exception) {
            Log.w(TAG, "Failed to send typing state", e)
        }
    }

    override fun observeTyping(conversationId: String, otherUserId: String): Flow<Boolean> = callbackFlow {
        val token = try {
            auth.currentUser?.getIdToken(false)?.await()?.token
                ?: throw IllegalStateException("Not signed in")
        } catch (e: Exception) {
            Log.e(TAG, "Failed to get auth token", e)
            trySend(false)
            close()
            return@callbackFlow
        }

        val wsUrl = baseUrl
            .replace("https://", "wss://")
            .replace("http://", "ws://")

        val request = Request.Builder()
            .url("$wsUrl/api/conversations/$conversationId/ws")
            .header("Authorization", "Bearer $token")
            .build()

        val ws = httpClient.newWebSocket(request, object : WebSocketListener() {
            override fun onOpen(webSocket: WebSocket, response: Response) {
                Log.d(TAG, "Typing WS connected for conversation=$conversationId")
            }

            override fun onMessage(webSocket: WebSocket, text: String) {
                try {
                    val json = JSONObject(text)
                    if (json.optString("type") == "typing") {
                        val userId = json.optString("userId")
                        val isTyping = json.optBoolean("isTyping", false)
                        if (userId == otherUserId) {
                            trySend(isTyping)
                        }
                    }
                } catch (e: Exception) {
                    Log.w(TAG, "Failed to parse typing message", e)
                }
            }

            override fun onClosing(webSocket: WebSocket, code: Int, reason: String) {
                webSocket.close(1000, null)
            }

            override fun onClosed(webSocket: WebSocket, code: Int, reason: String) {
                Log.d(TAG, "Typing WS closed: code=$code")
                if (activeWebSocket === webSocket) {
                    activeWebSocket = null
                    activeConversationId = null
                }
                trySend(false)
            }

            override fun onFailure(webSocket: WebSocket, t: Throwable, response: Response?) {
                Log.w(TAG, "Typing WS failure: ${t.message}")
                if (activeWebSocket === webSocket) {
                    activeWebSocket = null
                    activeConversationId = null
                }
                trySend(false)
            }
        })

        activeWebSocket = ws
        activeConversationId = conversationId

        awaitClose {
            Log.d(TAG, "Typing flow cancelled, closing WS for conversation=$conversationId")
            activeWebSocket = null
            activeConversationId = null
            ws.close(1000, "Flow cancelled")
        }
    }
}
