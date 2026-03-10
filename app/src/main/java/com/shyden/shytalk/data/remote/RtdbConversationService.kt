package com.shyden.shytalk.data.remote

import android.util.Log
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ValueEventListener
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow

/**
 * Conversation event service backed by Firebase Realtime Database.
 *
 * RTDB schema:
 *   conversations/{convId}/typing/{userId} = true  (client-managed, onDisconnect removes)
 *   conversations/{convId}/events/lastEvent = { type, ts }  (server-written)
 *
 * Replaces WebSocketConversationService — uses Firebase RTDB for real-time events.
 */
class RtdbConversationService : ConversationWebSocketService {

    companion object {
        private const val TAG = "RtdbConvService"
        private const val TYPING_TIMEOUT_MS = 5_000L
    }

    private val db by lazy { FirebaseDatabase.getInstance("https://shytalk-7ba69-default-rtdb.asia-southeast1.firebasedatabase.app") }

    private var currentConversationId: String? = null
    private var currentUserId: String? = null

    private var typingListener: ValueEventListener? = null
    private var eventsListener: ValueEventListener? = null
    private var lastEventTs = 0L

    /** Handler for auto-clearing typing after timeout. */
    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    private val clearTypingRunnable = Runnable {
        currentConversationId?.let { convId ->
            currentUserId?.let { userId ->
                db.getReference("conversations/$convId/typing/$userId").removeValue()
            }
        }
    }

    private val _events = MutableSharedFlow<ConversationEvent>(extraBufferCapacity = 16)
    override val events: Flow<ConversationEvent> = _events

    override fun connect(conversationId: String, userId: String) {
        if (currentConversationId != null && currentConversationId != conversationId) {
            disconnect()
        }

        currentConversationId = conversationId
        currentUserId = userId

        // Register onDisconnect cleanup for typing
        val typingRef = db.getReference("conversations/$conversationId/typing/$userId")
        typingRef.onDisconnect().removeValue()

        // Listen to typing indicators from other users
        val allTypingRef = db.getReference("conversations/$conversationId/typing")
        typingListener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                for (child in snapshot.children) {
                    val typingUserId = child.key ?: continue
                    if (typingUserId == userId) continue // skip self
                    val isTyping = child.getValue(Boolean::class.java) ?: false
                    _events.tryEmit(ConversationEvent.Typing(typingUserId, isTyping))
                }
            }

            override fun onCancelled(error: DatabaseError) {
                Log.w(TAG, "Typing listener cancelled: ${error.message}")
            }
        }.also { allTypingRef.addValueEventListener(it) }

        // Listen to conversation events
        val eventsRef = db.getReference("conversations/$conversationId/events/lastEvent")
        eventsListener = object : ValueEventListener {
            override fun onDataChange(snapshot: DataSnapshot) {
                val type = snapshot.child("type").getValue(String::class.java) ?: return
                val ts = snapshot.child("ts").getValue(Long::class.java) ?: return

                if (ts <= lastEventTs) return
                lastEventTs = ts

                when (type) {
                    "new_message" -> _events.tryEmit(ConversationEvent.NewMessage)
                }
            }

            override fun onCancelled(error: DatabaseError) {
                Log.w(TAG, "Events listener cancelled: ${error.message}")
            }
        }.also { eventsRef.addValueEventListener(it) }

        Log.d(TAG, "Connected to conversation=$conversationId user=$userId")
    }

    override fun disconnect() {
        val convId = currentConversationId ?: return
        val userId = currentUserId ?: return

        handler.removeCallbacks(clearTypingRunnable)

        // Clear typing indicator
        db.getReference("conversations/$convId/typing/$userId").removeValue()

        // Remove listeners
        typingListener?.let {
            db.getReference("conversations/$convId/typing").removeEventListener(it)
        }
        eventsListener?.let {
            db.getReference("conversations/$convId/events/lastEvent").removeEventListener(it)
        }

        typingListener = null
        eventsListener = null
        currentConversationId = null
        currentUserId = null
        lastEventTs = 0L

        Log.d(TAG, "Disconnected from conversation=$convId")
    }

    override fun sendTyping(isTyping: Boolean) {
        val convId = currentConversationId ?: return
        val userId = currentUserId ?: return
        val typingRef = db.getReference("conversations/$convId/typing/$userId")

        handler.removeCallbacks(clearTypingRunnable)

        if (isTyping) {
            typingRef.setValue(true)
            // Auto-clear after timeout
            handler.postDelayed(clearTypingRunnable, TYPING_TIMEOUT_MS)
        } else {
            typingRef.removeValue()
        }
    }
}
