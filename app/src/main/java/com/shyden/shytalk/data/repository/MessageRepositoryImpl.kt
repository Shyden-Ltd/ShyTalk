package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.MessageType
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.toMap
import com.shyden.shytalk.data.remote.PresenceService
import com.shyden.shytalk.data.remote.RoomEvent
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.filter
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.map
import kotlinx.coroutines.flow.merge
import kotlinx.coroutines.flow.transform
import org.json.JSONObject

class MessageRepositoryImpl(
    private val api: WorkerApiClient,
    private val presenceService: PresenceService
) : MessageRepository {

    override fun getMessages(roomId: String): Flow<List<Message>> = merge(
        // Slow fallback poll (10s)
        flow { while (true) { emit(Unit); delay(10_000) } },
        // Immediate refetch on new messages
        presenceService.roomEvents
            .filter { it is RoomEvent.NewMessage }
            .map { }
    ).transform {
        try {
            val arr = api.getArray("/api/rooms/$roomId/messages")
            val messages = (0 until arr.length()).mapNotNull { i ->
                val obj = arr.getJSONObject(i)
                Message.fromMap(obj.toMap(), obj.getString("messageId"))
            }
            emit(messages)
        } catch (_: Exception) { }
    }.distinctUntilChanged()

    private suspend fun createAndSendMessage(
        roomId: String,
        senderId: String,
        senderName: String,
        text: String,
        type: MessageType
    ): Resource<Unit> = firebaseCall("Failed to send message") {
        val body = JSONObject().apply {
            put("senderId", senderId)
            put("senderName", senderName)
            put("text", text)
            put("type", type.name)
        }
        api.post("/api/rooms/$roomId/messages", body)
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

    override suspend fun editMessage(
        roomId: String,
        messageId: String,
        newText: String
    ): Resource<Unit> = firebaseCall("Failed to edit message") {
        val body = JSONObject().apply { put("text", newText) }
        api.patch("/api/rooms/$roomId/messages/$messageId", body)
    }
}
