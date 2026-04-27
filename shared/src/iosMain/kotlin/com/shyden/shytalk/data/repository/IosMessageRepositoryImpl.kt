package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.MessageType
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.data.firestore.dataMap
import dev.gitlive.firebase.firestore.Direction
import dev.gitlive.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map

class IosMessageRepositoryImpl(
    private val firestore: FirebaseFirestore,
) : MessageRepository {
    override fun getMessages(roomId: String): Flow<List<Message>> =
        firestore
            .collection("rooms/$roomId/messages")
            .orderBy("createdAt", Direction.DESCENDING)
            .limit(200)
            .snapshots
            .map { snapshot ->
                snapshot.documents
                    .mapNotNull { doc ->
                        try {
                            val data = doc.dataMap()
                            Message.fromMap(data, doc.id)
                        } catch (e: Exception) {
                            null
                        }
                    }.reversed()
            }

    private suspend fun createAndSendMessage(
        roomId: String,
        senderId: String,
        senderName: String,
        text: String,
        type: MessageType,
    ): Resource<Unit> =
        firebaseCall("Failed to send message") {
            val msgId = firestore.collection("rooms/$roomId/messages").document.id
            val timestamp = currentTimeMillis()
            firestore
                .collection("rooms/$roomId/messages")
                .document(msgId)
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
                )
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
                .collection("rooms/$roomId/messages")
                .document(messageId)
                .updateFields {
                    "text" to newText
                    "isEdited" to true
                    "editedAt" to currentTimeMillis()
                }
        }
}
