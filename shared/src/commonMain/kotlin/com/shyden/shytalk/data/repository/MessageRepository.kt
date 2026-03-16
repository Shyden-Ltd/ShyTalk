package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.Message
import com.shyden.shytalk.core.util.Resource
import kotlinx.coroutines.flow.Flow

interface MessageRepository {
    fun getMessages(roomId: String): Flow<List<Message>>

    suspend fun sendMessage(
        roomId: String,
        senderId: String,
        senderName: String,
        text: String,
    ): Resource<Unit>

    suspend fun sendSystemMessage(
        roomId: String,
        text: String,
    ): Resource<Unit>

    suspend fun sendJoinMessage(
        roomId: String,
        senderId: String,
        senderName: String,
        text: String,
    ): Resource<Unit>

    suspend fun editMessage(
        roomId: String,
        messageId: String,
        newText: String,
    ): Resource<Unit>
}
