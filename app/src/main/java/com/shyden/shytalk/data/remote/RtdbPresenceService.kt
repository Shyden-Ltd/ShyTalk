package com.shyden.shytalk.data.remote

import android.util.Log
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ValueEventListener
import kotlinx.coroutines.CoroutineScope
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.SupervisorJob
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.launch
import kotlinx.coroutines.tasks.await
import okhttp3.OkHttpClient
import okhttp3.RequestBody.Companion.toRequestBody

/**
 * Presence service backed by Firebase Realtime Database.
 *
 * RTDB schema:
 *   rooms/{roomId}/presence/{userId} = true   (client-managed, onDisconnect removes)
 *   rooms/{roomId}/events/lastEvent = { type, ts, userId? }  (server-written)
 *
 * Replaces WebSocketPresenceService — uses Firebase RTDB for real-time presence.
 */
class RtdbPresenceService(
    private val httpClient: OkHttpClient,
    private val baseUrl: String,
) : PresenceService {
    companion object {
        private const val TAG = "RtdbPresenceService"
    }

    private val db by lazy { FirebaseDatabase.getInstance(com.shyden.shytalk.BuildConfig.RTDB_URL) }
    private val scope by lazy { CoroutineScope(SupervisorJob() + Dispatchers.Main.immediate) }

    private var currentRoomId: String? = null
    private var currentUserId: String? = null

    // Cron-elim A1 — owner-left signal state. Separate from currentRoomId/
    // currentUserId because non-owners also call setPresence but only owners
    // arm the signal; the reconnect listener guards re-arm by checking
    // currentOwnerRoomId.
    private var currentOwnerRoomId: String? = null
    private var currentOwnerFirebaseUid: String? = null

    private var presenceListener: ValueEventListener? = null
    private var eventsListener: ValueEventListener? = null
    private var connectedListener: ValueEventListener? = null

    private val presenceFlow = MutableStateFlow<Set<String>>(emptySet())
    private val _roomEvents = MutableSharedFlow<RoomEvent>(extraBufferCapacity = 16)
    override val roomEvents: Flow<RoomEvent> = _roomEvents

    /** Track last-seen event timestamp to deduplicate. */
    private var lastEventTs = 0L

    override fun setPresence(
        roomId: String,
        userId: String,
    ) {
        if (currentRoomId != null) {
            removePresence()
        }

        currentRoomId = roomId
        currentUserId = userId

        // Write presence + register onDisconnect cleanup
        val presenceRef = db.getReference("rooms/$roomId/presence/$userId")
        presenceRef.setValue(true)
        presenceRef.onDisconnect().removeValue()

        // Re-establish presence on RTDB reconnect (onDisconnect may have fired during a blip).
        // Cron-elim A1 — also re-arms the owner-left signal when this client
        // is the owner of this room. Owner-left signals fire only on the
        // owner-leaves-room transition, but a transient disconnect-reconnect
        // blip during owner-attendance must not leave the signal disarmed.
        val connectedRef = db.getReference(".info/connected")
        connectedListener =
            object : ValueEventListener {
                override fun onDataChange(snapshot: DataSnapshot) {
                    val connected = snapshot.getValue(Boolean::class.java) ?: false
                    if (!connected || currentRoomId != roomId || currentUserId != userId) return
                    presenceRef.setValue(true)
                    presenceRef.onDisconnect().removeValue()
                    val ownerFuid = currentOwnerFirebaseUid
                    if (currentOwnerRoomId == roomId && ownerFuid != null) {
                        val ownerLeftRef = db.getReference("ownerLeft/$roomId")
                        ownerLeftRef.onDisconnect().cancel()
                        ownerLeftRef.setValue(ownerFuid)
                        ownerLeftRef.onDisconnect().setValue(ownerFuid)
                    }
                }

                override fun onCancelled(error: DatabaseError) {
                    Log.w(TAG, "Connected listener cancelled: ${error.message}")
                }
            }
        connectedListener?.let { connectedRef.addValueEventListener(it) }

        // Listen to all presence in this room
        val roomPresenceRef = db.getReference("rooms/$roomId/presence")
        presenceListener =
            object : ValueEventListener {
                override fun onDataChange(snapshot: DataSnapshot) {
                    val userIds = snapshot.children.mapNotNull { it.key }.toSet()
                    presenceFlow.value = userIds
                }

                override fun onCancelled(error: DatabaseError) {
                    Log.w(TAG, "Presence listener cancelled: ${error.message}")
                }
            }
        presenceListener?.let { roomPresenceRef.addValueEventListener(it) }

        // Listen to room events
        val eventsRef = db.getReference("rooms/$roomId/events/lastEvent")
        eventsListener =
            object : ValueEventListener {
                override fun onDataChange(snapshot: DataSnapshot) {
                    val type = snapshot.child("type").getValue(String::class.java) ?: return
                    val ts = snapshot.child("ts").getValue(Long::class.java) ?: return

                    // Deduplicate: skip if we've already seen this timestamp
                    if (ts <= lastEventTs) return
                    lastEventTs = ts

                    val eventUserId = snapshot.child("userId").getValue(String::class.java)

                    val event =
                        when (type) {
                            "room_updated" -> RoomEvent.RoomUpdated

                            "new_message" -> RoomEvent.NewMessage

                            "seat_request_updated" -> RoomEvent.SeatRequestUpdated

                            "room_closed" -> RoomEvent.RoomClosed

                            "kicked" -> {
                                val kickedId = eventUserId ?: return
                                RoomEvent.UserKicked(kickedId)
                            }

                            else -> {
                                Log.d(TAG, "Unknown room event type: $type")
                                return
                            }
                        }

                    _roomEvents.tryEmit(event)

                    // If this user was kicked, stop reconnecting
                    if (event is RoomEvent.UserKicked && event.userId == currentUserId) {
                        removePresence()
                    }
                    if (event is RoomEvent.RoomClosed) {
                        removePresence()
                    }
                }

                override fun onCancelled(error: DatabaseError) {
                    Log.w(TAG, "Events listener cancelled: ${error.message}")
                }
            }
        eventsListener?.let { eventsRef.addValueEventListener(it) }

        Log.d(TAG, "Presence set for room=$roomId user=$userId")
    }

    override fun removePresence() {
        // Cron-elim A1 — always cancel the owner-left signal first so every
        // removePresence callsite (5+ in ActiveRoomManager) gets owner-left
        // cancel "for free" without per-callsite churn. Safe no-op when no
        // signal is armed.
        cancelOwnerLeftSignal()

        val roomId = currentRoomId ?: return
        val userId = currentUserId ?: return

        // Remove our presence
        db.getReference("rooms/$roomId/presence/$userId").removeValue()

        // Remove listeners
        presenceListener?.let {
            db.getReference("rooms/$roomId/presence").removeEventListener(it)
        }
        eventsListener?.let {
            db.getReference("rooms/$roomId/events/lastEvent").removeEventListener(it)
        }
        connectedListener?.let {
            db.getReference(".info/connected").removeEventListener(it)
        }

        presenceListener = null
        eventsListener = null
        connectedListener = null
        currentRoomId = null
        currentUserId = null
        presenceFlow.value = emptySet()
        lastEventTs = 0L

        Log.d(TAG, "Presence removed for room=$roomId user=$userId")
    }

    override fun observeRoomPresence(roomId: String): Flow<Set<String>> = presenceFlow

    override suspend fun isUserPresent(
        roomId: String,
        userId: String,
    ): Boolean =
        try {
            val snapshot = db.getReference("rooms/$roomId/presence/$userId").get().await()
            snapshot.exists() && snapshot.getValue(Boolean::class.java) == true
        } catch (e: Exception) {
            Log.w(TAG, "isUserPresent check failed: ${e.message}")
            false
        }

    override fun armOwnerLeftSignal(
        roomId: String,
        ownerFirebaseUid: String,
    ) {
        // Replace-roomId idempotency: if a prior signal is armed for a
        // different room, cancel it first. Otherwise the stale signal would
        // fire when the connection drops, attempting to close a room the
        // owner already cleanly left.
        if (currentOwnerRoomId != null && currentOwnerRoomId != roomId) {
            cancelOwnerLeftSignal()
        }

        // Sequence MUST be: onDisconnect().cancel() → setValue → onDisconnect().setValue
        //
        // The cancel-first defends against a stale onDisconnect registration
        // from a prior arm on the same path (e.g. re-entering the same room
        // after a forced re-arm). Skipping cancel-first leaves both
        // registrations queued and BOTH fire on disconnect, producing
        // duplicate signal entries — the server-side listener handles
        // dedup but spamming RTDB is wasteful.
        //
        // The setValue (vs no immediate write) ensures the entry exists
        // BEFORE the onDisconnect arms — otherwise the server-side
        // child_added listener would only fire on the next disconnect, not
        // on the arm. The arm SHOULD trigger a child_added (the server
        // orchestrator's TOCTOU re-check resolves: owner is still present,
        // NOOP), making the listener path exercise itself on every arm.
        val ownerLeftRef = db.getReference("ownerLeft/$roomId")
        ownerLeftRef.onDisconnect().cancel()
        ownerLeftRef.setValue(ownerFirebaseUid)
        ownerLeftRef.onDisconnect().setValue(ownerFirebaseUid)

        currentOwnerRoomId = roomId
        currentOwnerFirebaseUid = ownerFirebaseUid

        Log.d(TAG, "armOwnerLeftSignal room=$roomId")
    }

    override fun cancelOwnerLeftSignal() {
        val roomId = currentOwnerRoomId ?: return

        // Symmetric cleanup: cancel the onDisconnect FIRST (so a race-y
        // disconnect during this method doesn't fire the stale signal),
        // then remove the entry. Reverse order would briefly leave the
        // entry present with no onDisconnect, but a disconnect at THAT
        // moment would leave the entry orphaned — the server listener
        // would still process it, but on a normal cancel-path that's a
        // spurious signal.
        val ownerLeftRef = db.getReference("ownerLeft/$roomId")
        ownerLeftRef.onDisconnect().cancel()
        ownerLeftRef.removeValue()

        currentOwnerRoomId = null
        currentOwnerFirebaseUid = null

        Log.d(TAG, "cancelOwnerLeftSignal room=$roomId")
    }

    /**
     * Detect owner absence from the presence set and call the Worker API.
     * Called by ActiveRoomManager when it observes presence changes.
     */
    fun notifyOwnerAway(roomId: String) {
        scope.launch(Dispatchers.IO) {
            try {
                val token =
                    com.google.firebase.auth.FirebaseAuth
                        .getInstance()
                        .currentUser
                        ?.getIdToken(false)
                        ?.await()
                        ?.token ?: return@launch

                val emptyBody = "".toRequestBody(null)
                val request =
                    okhttp3.Request
                        .Builder()
                        .url("$baseUrl/api/rooms/$roomId/owner-away")
                        .header("Authorization", "Bearer $token")
                        .post(emptyBody)
                        .build()

                httpClient.newCall(request).execute().close()
            } catch (e: Exception) {
                Log.w(TAG, "Failed to notify owner-away: ${e.message}")
            }
        }
    }
}
