package com.shyden.shytalk.data.remote

import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.logD
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.repository.TypingRepository
import dev.gitlive.firebase.database.FirebaseDatabase
import kotlinx.coroutines.CancellationException
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
            } catch (e: CancellationException) {
                throw e
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
        } catch (e: CancellationException) {
            throw e
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
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                logW(TAG, "setPresence failed: ${e.message}")
            }
        }
    }

    override fun removePresence() {
        // Cron-elim A1 — pin the auto-cancel contract NOW so PR A2 only has
        // to implement the function body. cancelOwnerLeftSignal is a no-op
        // stub today; once A2 makes it real, this call site already wires
        // the contract that "every removePresence cleans up owner-left."
        // Mirrors the Android RtdbPresenceService.removePresence pattern.
        cancelOwnerLeftSignal()

        val roomId = currentRoomId ?: return
        val userId = currentUserId ?: return
        scope.launch {
            try {
                database.reference("rooms/$roomId/presence/$userId").removeValue()
            } catch (e: CancellationException) {
                throw e
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
        } catch (e: CancellationException) {
            throw e
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
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            false
        }

    // ── Owner-left signal (NO-OP STUB — real iOS impl in PR A2) ──
    //
    // The Android RtdbPresenceService implements arm/cancel against the
    // RTDB `ownerLeft/{roomId}` path with an onDisconnect trigger; the
    // server-side listener (express-api/src/utils/owner-left-*.js) consumes
    // these signals and decides whether to close or transition the room.
    // Until PR A2 lands the real iOS impl, owner-left signal arming on iOS
    // is a no-op — the legacy lazy-reap path (PR #996) still handles iOS-
    // owned rooms via on-access reaping with the 5-min grace window.

    override fun armOwnerLeftSignal(
        roomId: String,
        ownerFirebaseUid: String,
    ) {
        // TODO(PR A2): real iOS impl via database.reference("ownerLeft/$roomId")
        //   .setValue(ownerFirebaseUid) + .onDisconnect().setValue(ownerFirebaseUid)
        logD(TAG, "armOwnerLeftSignal STUB (iOS A2 pending) roomId=$roomId")
    }

    override fun cancelOwnerLeftSignal() {
        // TODO(PR A2): real iOS impl via database.reference("ownerLeft/$currentOwnerRoomId")
        //   .onDisconnect().cancel() + .removeValue()
        //
        // IMPORTANT — A2 implementor: this method is called UNCONDITIONALLY
        // from removePresence (line 113) BEFORE the currentRoomId null
        // check. The implementation MUST guard internally on
        // currentOwnerRoomId (mirror Android RtdbPresenceService.cancelOwnerLeftSignal
        // line 261: `val roomId = currentOwnerRoomId ?: return`). Without
        // the internal guard, calling cancelOwnerLeftSignal when no signal
        // is armed will attempt to write to ownerLeft/null and corrupt
        // the path. Safe today because this is a no-op log; trap for A2.
        logD(TAG, "cancelOwnerLeftSignal STUB (iOS A2 pending)")
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
            } catch (e: CancellationException) {
                throw e
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
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                logW(TAG, "sendTyping failed: ${e.message}")
            }
        }
    }
}
