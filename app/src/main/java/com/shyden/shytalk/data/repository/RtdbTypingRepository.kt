package com.shyden.shytalk.data.repository

import android.util.Log
import com.google.firebase.database.DataSnapshot
import com.google.firebase.database.DatabaseError
import com.google.firebase.database.FirebaseDatabase
import com.google.firebase.database.ValueEventListener
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow

/**
 * Typing repository backed by Firebase Realtime Database.
 *
 * RTDB schema:
 *   conversations/{convId}/typing/{userId} = true
 *
 * Each user writes their own typing node; onDisconnect clears it.
 * Replaces TypingRepositoryImpl (WebSocket-based).
 */
class RtdbTypingRepository : TypingRepository {
    companion object {
        private const val TAG = "RtdbTypingRepo"
        private const val TYPING_TIMEOUT_MS = 5_000L
    }

    private val db by lazy { FirebaseDatabase.getInstance(com.shyden.shytalk.BuildConfig.RTDB_URL) }

    private val handler = android.os.Handler(android.os.Looper.getMainLooper())
    private var clearRunnable: Runnable? = null
    private var activeConversationId: String? = null
    private var activeUserId: String? = null

    override fun setTyping(
        conversationId: String,
        userId: String,
        isTyping: Boolean,
    ) {
        val typingRef = db.getReference("conversations/$conversationId/typing/$userId")

        // Cancel any pending clear
        clearRunnable?.let { handler.removeCallbacks(it) }

        if (isTyping) {
            typingRef.setValue(true)
            typingRef.onDisconnect().removeValue()
            activeConversationId = conversationId
            activeUserId = userId

            // Auto-clear after timeout
            val runnable = Runnable { typingRef.removeValue() }
            clearRunnable = runnable
            handler.postDelayed(runnable, TYPING_TIMEOUT_MS)
        } else {
            typingRef.removeValue()
            activeConversationId = null
            activeUserId = null
        }
    }

    override fun observeTyping(
        conversationId: String,
        otherUserId: String,
    ): Flow<Boolean> =
        callbackFlow {
            val typingRef = db.getReference("conversations/$conversationId/typing/$otherUserId")

            val listener =
                object : ValueEventListener {
                    override fun onDataChange(snapshot: DataSnapshot) {
                        val isTyping = snapshot.getValue(Boolean::class.java) ?: false
                        trySend(isTyping)
                    }

                    override fun onCancelled(error: DatabaseError) {
                        Log.w(TAG, "Typing listener cancelled: ${error.message}")
                        trySend(false)
                    }
                }

            typingRef.addValueEventListener(listener)

            awaitClose {
                typingRef.removeEventListener(listener)
                // Clean up own typing state if we were actively typing
                if (activeConversationId == conversationId && activeUserId != null) {
                    db
                        .getReference("conversations/$conversationId/typing/$activeUserId")
                        .removeValue()
                    clearRunnable?.let { handler.removeCallbacks(it) }
                    activeConversationId = null
                    activeUserId = null
                }
            }
        }
}
