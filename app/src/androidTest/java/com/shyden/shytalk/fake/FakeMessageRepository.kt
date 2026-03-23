package com.shyden.shytalk.fake

import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.model.MessageType
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.MessageRepository
import com.shyden.shytalk.testdata.TestData
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow

class FakeMessageRepository : MessageRepository {
    val messagesMap =
        mutableMapOf<String, MutableStateFlow<List<Message>>>(
            "room-1" to MutableStateFlow(TestData.sampleRoomMessages),
        )

    override fun getMessages(roomId: String): Flow<List<Message>> = messagesMap.getOrPut(roomId) { MutableStateFlow(emptyList()) }

    override suspend fun sendMessage(
        roomId: String,
        senderId: String,
        senderName: String,
        text: String,
    ): Resource<Unit> {
        val flow = messagesMap.getOrPut(roomId) { MutableStateFlow(emptyList()) }
        val msg =
            Message(
                messageId = "msg-${System.currentTimeMillis()}",
                senderId = senderId,
                senderName = senderName,
                text = text,
                type = MessageType.TEXT,
            )
        flow.value = flow.value + msg
        return Resource.Success(Unit)
    }

    override suspend fun sendSystemMessage(
        roomId: String,
        text: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun sendJoinMessage(
        roomId: String,
        senderId: String,
        senderName: String,
        text: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun editMessage(
        roomId: String,
        messageId: String,
        newText: String,
    ): Resource<Unit> = Resource.Success(Unit)
}
