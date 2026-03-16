package com.shyden.shytalk.data.remote

import kotlinx.coroutines.flow.Flow

/**
 * Service for real-time conversation events.
 * Implemented via Firebase RTDB listeners for
 * instant message notifications and typing indicators.
 */
interface ConversationWebSocketService {
    fun connect(
        conversationId: String,
        userId: String,
    )

    fun disconnect()

    fun sendTyping(isTyping: Boolean)

    val events: Flow<ConversationEvent>
}

sealed class ConversationEvent {
    data object NewMessage : ConversationEvent()

    data class Typing(
        val userId: String,
        val isTyping: Boolean,
    ) : ConversationEvent()
}
