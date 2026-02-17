package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.MessageType
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.currentTimeMillis
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.tasks.await
import java.util.UUID

class MessageRepositoryImpl(
    private val firestore: FirebaseFirestore
) : MessageRepository {

    private fun messagesCollection(roomId: String) =
        firestore.collection("rooms").document(roomId).collection("messages")

    override fun getMessages(roomId: String): Flow<List<Message>> = callbackFlow {
        val listener = messagesCollection(roomId)
            .orderBy("createdAt", Query.Direction.ASCENDING)
            .limitToLast(Constants.MAX_ROOM_MESSAGES.toLong())
            .addSnapshotListener { snapshot, error ->
                if (error != null) {
                    close(error)
                    return@addSnapshotListener
                }
                val messages = snapshot?.documents?.mapNotNull { doc ->
                    doc.data?.let { Message.fromMap(it, doc.id) }
                } ?: emptyList()
                trySend(messages)
            }
        awaitClose { listener.remove() }
    }.distinctUntilChanged()

    private suspend fun createAndSendMessage(
        roomId: String,
        senderId: String,
        senderName: String,
        text: String,
        type: MessageType
    ): Resource<Unit> = firebaseCall("Failed to send message") {
        val messageId = UUID.randomUUID().toString()
        val message = Message(
            messageId = messageId,
            senderId = senderId,
            senderName = senderName,
            text = text,
            createdAt = currentTimeMillis(),
            type = type
        )
        messagesCollection(roomId).document(messageId).set(message.toMap()).await()
        trimOldMessages(roomId)
    }

    private suspend fun trimOldMessages(roomId: String) {
        val collection = messagesCollection(roomId)
        val snapshot = collection
            .orderBy("createdAt", Query.Direction.ASCENDING)
            .get()
            .await()
        val excess = snapshot.documents.size - Constants.MAX_ROOM_MESSAGES
        if (excess > 0) {
            val batch = firestore.batch()
            snapshot.documents.take(excess).forEach { batch.delete(it.reference) }
            batch.commit().await()
        }
    }

    override suspend fun sendMessage(
        roomId: String,
        senderId: String,
        senderName: String,
        text: String
    ): Resource<Unit> = createAndSendMessage(roomId, senderId, senderName, text, MessageType.TEXT)

    override suspend fun sendSystemMessage(roomId: String, text: String): Resource<Unit> =
        createAndSendMessage(roomId, "system", "System", text, MessageType.SYSTEM)

    override suspend fun sendJoinMessage(
        roomId: String,
        senderId: String,
        senderName: String,
        text: String
    ): Resource<Unit> = createAndSendMessage(roomId, senderId, senderName, text, MessageType.JOIN)
}
