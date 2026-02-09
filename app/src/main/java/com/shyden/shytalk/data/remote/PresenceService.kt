package com.shyden.shytalk.data.remote

import android.util.Log
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ServerValue
import javax.inject.Inject
import javax.inject.Singleton

@Singleton
class PresenceService @Inject constructor(
    private val database: FirebaseDatabase
) {
    companion object {
        private const val TAG = "PresenceService"
    }

    private var currentRoomId: String? = null
    private var currentUserId: String? = null

    fun setPresence(roomId: String, userId: String) {
        // Clean up previous presence if switching rooms
        if (currentRoomId != null && currentRoomId != roomId) {
            removePresence()
        }

        currentRoomId = roomId
        currentUserId = userId

        val ref = database.getReference("presence/$roomId/$userId")
        ref.setValue(ServerValue.TIMESTAMP)
        ref.onDisconnect().removeValue()
        Log.d(TAG, "Presence set for room=$roomId user=$userId")
    }

    fun removePresence() {
        val roomId = currentRoomId ?: return
        val userId = currentUserId ?: return

        val ref = database.getReference("presence/$roomId/$userId")
        ref.onDisconnect().cancel()
        ref.removeValue()
        Log.d(TAG, "Presence removed for room=$roomId user=$userId")

        currentRoomId = null
        currentUserId = null
    }
}
