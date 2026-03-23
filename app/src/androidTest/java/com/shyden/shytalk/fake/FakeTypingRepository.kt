package com.shyden.shytalk.fake

import com.shyden.shytalk.data.repository.TypingRepository
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.flowOf

class FakeTypingRepository : TypingRepository {
    override fun setTyping(
        conversationId: String,
        userId: String,
        isTyping: Boolean,
    ) { /* no-op */ }

    override fun observeTyping(
        conversationId: String,
        otherUserId: String,
    ): Flow<Boolean> = flowOf(false)
}
