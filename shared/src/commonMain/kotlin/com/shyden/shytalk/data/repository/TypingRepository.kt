package com.shyden.shytalk.data.repository

import kotlinx.coroutines.flow.Flow

interface TypingRepository {
    fun setTyping(
        conversationId: String,
        userId: String,
        isTyping: Boolean,
    )

    fun observeTyping(
        conversationId: String,
        otherUserId: String,
    ): Flow<Boolean>
}
