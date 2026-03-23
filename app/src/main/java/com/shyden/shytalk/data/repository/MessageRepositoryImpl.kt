package com.shyden.shytalk.data.repository

import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.MessageType
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await

class MessageRepositoryImpl(
    private val firestore: FirebaseFirestore,
) : MessageRepository {
    // Real-time room messages from Firestore subcollection
    override fun getMessages(roomId: String): Flow<List<Message>> =
        callbackFlow {
            val listener =
                firestore
                    .collection("rooms/$roomId/messages")
                    .orderBy("createdAt", Query.Direction.ASCENDING)
                    .limitToLast(200)
                    .addSnapshotListener { snapshot, error ->
                        if (error != null || snapshot == null) return@addSnapshotListener
                        val messages =
                            snapshot.documents.mapNotNull { doc ->
                                val data = doc.data ?: return@mapNotNull null
                                Message.fromMap(data, doc.id)
                            }
                        trySend(messages)
                    }
            awaitClose { listener.remove() }
        }

    // Direct Firestore write — room messages don't need FCM push
    // (participants have real-time listeners)
    private suspend fun createAndSendMessage(
        roomId: String,
        senderId: String,
        senderName: String,
        text: String,
        type: MessageType,
    ): Resource<Unit> =
        firebaseCall("Failed to send message") {
            val msgId = firestore.collection("rooms/$roomId/messages").document().id
            val timestamp = System.currentTimeMillis()
            firestore
                .document("rooms/$roomId/messages/$msgId")
                .set(
                    mapOf(
                        "id" to msgId,
                        "roomId" to roomId,
                        "senderId" to senderId,
                        "senderName" to senderName,
                        "text" to text,
                        "type" to type.name,
                        "createdAt" to timestamp,
                    ),
                ).await()
        }

    override suspend fun sendMessage(
        roomId: String,
        senderId: String,
        senderName: String,
        text: String,
    ): Resource<Unit> = createAndSendMessage(roomId, senderId, senderName, text, MessageType.TEXT)

    override suspend fun sendSystemMessage(
        roomId: String,
        text: String,
    ): Resource<Unit> = createAndSendMessage(roomId, "system", "System", text, MessageType.SYSTEM)

    override suspend fun sendJoinMessage(
        roomId: String,
        senderId: String,
        senderName: String,
        text: String,
    ): Resource<Unit> = createAndSendMessage(roomId, senderId, senderName, text, MessageType.JOIN)

    override suspend fun editMessage(
        roomId: String,
        messageId: String,
        newText: String,
    ): Resource<Unit> =
        firebaseCall("Failed to edit message") {
            firestore
                .document("rooms/$roomId/messages/$messageId")
                .update(
                    mapOf(
                        "text" to newText,
                        "isEdited" to true,
                        "editedAt" to System.currentTimeMillis(),
                    ),
                ).await()
        }
}
