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
import kotlinx.coroutines.flow.first
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

    // Cron-elim A2 — owner-left signal state. Separate from currentRoomId
    // / currentUserId because non-owners also call setPresence but only
    // owners arm the signal; cancelOwnerLeftSignal guards internally on
    // currentOwnerRoomId so the unconditional call from removePresence is
    // safe when no signal is armed.
    private var currentOwnerRoomId: String? = null
    private var currentOwnerFirebaseUid: String? = null

    private val _roomEvents = MutableSharedFlow<RoomEvent>(extraBufferCapacity = 10)

    override val roomEvents: Flow<RoomEvent> = _roomEvents.asSharedFlow()

    override fun setPresence(
        roomId: String,
        userId: String,
    ) {
        // Cron-elim A2 gap: unlike Android RtdbPresenceService.setPresence
        // (lines 81-102) which registers a .info/connected listener that
        // re-arms BOTH presence AND the owner-left signal on RTDB
        // reconnect blips, iOS has no such listener. Transient mobile-
        // network drops (WiFi↔cellular handoffs, brief underground
        // transit) on iOS-owned rooms will: fire the onDisconnect signal
        // → server orchestrator processes → TOCTOU re-check sees owner
        // re-present (owner just reconnected) → NOOP → signal cleared.
        // The TOCTOU re-check mitigates correctness; the cost is one
        // round-trip of spurious server work per reconnect blip. Adding
        // the .info/connected listener requires also extending iOS
        // basic-presence reconnect handling and is queued as a
        // standalone follow-up (Task #9) per the architect blueprint
        // scoping A2 to arm/cancel + isUserPresent.
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
        // Cron-elim A1+A2 — cancelOwnerLeftSignal is called first so all
        // room-exit paths get owner-left cleanup for free. Internal null-
        // guard inside cancelOwnerLeftSignal makes this safe to call even
        // when no signal is armed (non-owners, post-cancel re-call, etc).
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
            // Cron-elim A2 — one-shot read via valueEvents.first(). The
            // pre-A2 stub returned false unconditionally, which broke
            // client-side TOCTOU re-check semantics for iOS users —
            // ActiveRoomManager.kt:493 uses isUserPresent as a grace-
            // period re-check before marking users disconnected, and
            // the pre-A2 stub made that re-check a no-op (always
            // reported absent). Uses snapshot.exists — the
            // serialization-free property that returns true for any
            // non-null value, correct for the iOS presence shape (this
            // file writes a Long timestamp via .setValue(Long) at
            // setPresence).
            //
            // Cross-platform presence-node data shape is inconsistent:
            //   - Android (RtdbPresenceService:73): writes Boolean `true`
            //   - iOS (IosPresenceServiceImpl:120):  writes Long timestamp
            // Android's isUserPresent at RtdbPresenceService:217 uses
            //   snapshot.exists() && snapshot.getValue(Boolean::class.java) == true
            // which works for Android-written nodes (Boolean true coerces
            // back to true) but FAILS for iOS-written nodes: getValue(
            // Boolean::class.java) returns null on a Long, so the full
            // expression evaluates to false even when the node exists.
            // Net effect: an Android client checking the presence of an
            // iOS user always sees them as absent, making the grace-
            // period TOCTOU re-check in ActiveRoomManager a no-op for
            // cross-platform rooms. Task #10 fixes this by simplifying
            // Android to snapshot.exists() (matches the iOS impl shape
            // here and handles either data type). Harmonising the
            // write-side data shape across platforms is a deeper
            // anti-pattern fix tracked separately.
            val snapshot = database.reference("rooms/$roomId/presence/$userId").valueEvents.first()
            snapshot.exists
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logW(TAG, "isUserPresent failed: ${e.message}")
            false
        }

    override fun armOwnerLeftSignal(
        roomId: String,
        ownerFirebaseUid: String,
    ) {
        // Replace-roomId idempotency: cancel any prior arm before
        // installing the new one. Stale onDisconnect entries from a
        // prior room would otherwise fire on disconnect and attempt to
        // close a room the owner already cleanly left. Mirrors the
        // Android RtdbPresenceService.armOwnerLeftSignal pattern.
        if (currentOwnerRoomId != null && currentOwnerRoomId != roomId) {
            cancelOwnerLeftSignal()
        }

        // State set BEFORE scope.launch so a synchronously-following
        // cancelOwnerLeftSignal() (e.g., immediate removePresence) sees
        // the armed state and queues a cancel. Race window: if the
        // launched arm coroutine and the launched cancel coroutine
        // interleave on Dispatchers.Default such that arm runs LAST,
        // the RTDB write briefly creates an orphan signal. The server-
        // side listener's TOCTOU re-check (owner still present at
        // signal-fire time → NOOP → remove signal) self-heals this:
        // the orphan exists for one server processing round-trip then
        // disappears. A Mutex would eliminate the race but adds lock
        // contention to every arm/cancel for a self-healing edge case.
        currentOwnerRoomId = roomId
        currentOwnerFirebaseUid = ownerFirebaseUid

        scope.launch {
            try {
                // Sequence: onDisconnect().cancel() → setValue → onDisconnect().setValue
                // The cancel-first defends against a stale onDisconnect
                // registration from a prior arm on the same path. The
                // setValue ensures the entry exists BEFORE the
                // onDisconnect arms so the server-side child_added
                // listener fires on the arm (TOCTOU re-check resolves
                // owner-still-present → NOOP), exercising the listener
                // path on every arm.
                val ref = database.reference("ownerLeft/$roomId")
                ref.onDisconnect().cancel()
                ref.setValue(ownerFirebaseUid)
                ref.onDisconnect().setValue(ownerFirebaseUid)
                logD(TAG, "armOwnerLeftSignal room=$roomId")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                logW(TAG, "armOwnerLeftSignal failed: ${e.message}")
            }
        }
    }

    override fun cancelOwnerLeftSignal() {
        // Internal null-guard — called UNCONDITIONALLY from removePresence
        // BEFORE its own null-check on currentRoomId. Without this guard,
        // attempting to write to ownerLeft/null would corrupt the path.
        // Mirrors the Android RtdbPresenceService.cancelOwnerLeftSignal
        // guard at line ~261.
        val roomId = currentOwnerRoomId ?: return

        currentOwnerRoomId = null
        currentOwnerFirebaseUid = null

        scope.launch {
            try {
                // Symmetric cleanup: cancel onDisconnect FIRST so a race-y
                // disconnect during this method doesn't fire the stale
                // signal, then remove the entry.
                val ref = database.reference("ownerLeft/$roomId")
                ref.onDisconnect().cancel()
                ref.removeValue()
                logD(TAG, "cancelOwnerLeftSignal room=$roomId")
            } catch (e: CancellationException) {
                throw e
            } catch (e: Exception) {
                logW(TAG, "cancelOwnerLeftSignal failed: ${e.message}")
            }
        }
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
