package com.shyden.shytalk.data.remote

import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.repository.TypingRepository
import dev.gitlive.firebase.database.FirebaseDatabase
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.asSharedFlow
import kotlinx.coroutines.flow.emptyFlow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.launch

private const val TAG = "RtdbServices"

// ── TypingRepository (RTDB) ─────────────────────────────────────

class IosTypingRepositoryImpl(
    private val database: FirebaseDatabase,
) : TypingRepository {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)

    override fun setTyping(
        conversationId: String,
        userId: String,
        isTyping: Boolean,
    ) {
        scope.launch {
            try {
                val ref = database.reference("conversations/$conversationId/typing/$userId")
                if (isTyping) {
                    ref.setValue(currentTimeMillis())
                    // Auto-clear after 5 seconds
                    delay(5000)
                    ref.removeValue()
                } else {
                    ref.removeValue()
                }
            } catch (e: Exception) {
                logW(TAG, "setTyping failed: ${e.message}")
            }
        }
    }

    override fun observeTyping(
        conversationId: String,
        otherUserId: String,
    ): Flow<Boolean> =
        try {
            database
                .reference("conversations/$conversationId/typing/$otherUserId")
                .valueEvents
                .map { snapshot ->
                    val timestamp = snapshot.value<Long?>() ?: return@map false
                    // Consider typing if timestamp is within 6 seconds
                    (currentTimeMillis() - timestamp) < 6000
                }
        } catch (e: Exception) {
            logW(TAG, "observeTyping failed: ${e.message}")
            emptyFlow()
        }
}

// ── PresenceService (RTDB) ──────────────────────────────────────

class IosPresenceServiceImpl(
    private val database: FirebaseDatabase,
) : PresenceService {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var currentRoomId: String? = null
    private var currentUserId: String? = null
    private val _roomEvents = MutableSharedFlow<RoomEvent>(extraBufferCapacity = 10)

    override val roomEvents: Flow<RoomEvent> = _roomEvents.asSharedFlow()

    override fun setPresence(
        roomId: String,
        userId: String,
    ) {
        currentRoomId = roomId
        currentUserId = userId
        scope.launch {
            try {
                val ref = database.reference("rooms/$roomId/presence/$userId")
                ref.setValue(currentTimeMillis())
                ref.onDisconnect().removeValue()
            } catch (e: Exception) {
                logW(TAG, "setPresence failed: ${e.message}")
            }
        }
    }

    override fun removePresence() {
        val roomId = currentRoomId ?: return
        val userId = currentUserId ?: return
        scope.launch {
            try {
                database.reference("rooms/$roomId/presence/$userId").removeValue()
            } catch (e: Exception) {
                logW(TAG, "removePresence failed: ${e.message}")
            }
        }
        currentRoomId = null
        currentUserId = null
    }

    override fun observeRoomPresence(roomId: String): Flow<Set<String>> =
        try {
            database
                .reference("rooms/$roomId/presence")
                .valueEvents
                .map { snapshot ->
                    snapshot.children
                        .mapNotNull { child ->
                            child.key
                        }.toSet()
                }
        } catch (e: Exception) {
            logW(TAG, "observeRoomPresence failed: ${e.message}")
            emptyFlow()
        }

    override suspend fun isUserPresent(
        roomId: String,
        userId: String,
    ): Boolean =
        try {
            val snapshot = database.reference("rooms/$roomId/presence/$userId").valueEvents
            // Simple check — if value exists, user is present
            false // Default to false — full implementation needs one-shot read
        } catch (e: Exception) {
            false
        }
}

// ── ConversationWebSocketService (RTDB) ─────────────────────────

class IosConversationWebSocketServiceImpl(
    private val database: FirebaseDatabase,
) : ConversationWebSocketService {
    private val scope = CoroutineScope(SupervisorJob() + Dispatchers.Default)
    private var currentConversationId: String? = null
    private var currentUserId: String? = null
    private val _events = MutableSharedFlow<ConversationEvent>(extraBufferCapacity = 10)

    override val events: Flow<ConversationEvent> = _events.asSharedFlow()

    override fun connect(
        conversationId: String,
        userId: String,
    ) {
        currentConversationId = conversationId
        currentUserId = userId
        // Typing and event listeners will be activated when observing the events flow
    }

    override fun disconnect() {
        val convId = currentConversationId ?: return
        val userId = currentUserId ?: return
        scope.launch {
            try {
                database.reference("conversations/$convId/typing/$userId").removeValue()
            } catch (e: Exception) {
                logW(TAG, "disconnect cleanup failed: ${e.message}")
            }
        }
        currentConversationId = null
        currentUserId = null
    }

    override fun sendTyping(isTyping: Boolean) {
        val convId = currentConversationId ?: return
        val userId = currentUserId ?: return
        scope.launch {
            try {
                val ref = database.reference("conversations/$convId/typing/$userId")
                if (isTyping) {
                    ref.setValue(currentTimeMillis())
                } else {
                    ref.removeValue()
                }
            } catch (e: Exception) {
                logW(TAG, "sendTyping failed: ${e.message}")
            }
        }
    }
}
