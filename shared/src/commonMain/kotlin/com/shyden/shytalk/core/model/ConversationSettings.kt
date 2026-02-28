package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.asBool
import com.shyden.shytalk.core.util.timestampToMillis

data class ConversationSettings(
    val userId: String = "",
    val isMuted: Boolean = false,
    val isHidden: Boolean = false,
    val hiddenAt: Long? = null,
    val isPinned: Boolean = false,
    val lastReadMessageId: String = "",
    val lastReadAt: Long = 0,
    val unreadCount: Long = 0
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "userId" to userId,
        "isMuted" to isMuted,
        "isHidden" to isHidden,
        "hiddenAt" to hiddenAt,
        "isPinned" to isPinned,
        "lastReadMessageId" to lastReadMessageId,
        "lastReadAt" to lastReadAt,
        "unreadCount" to unreadCount
    )

    companion object {
        fun fromMap(map: Map<String, Any?>, userId: String): ConversationSettings = ConversationSettings(
            userId = userId,
            isMuted = map["isMuted"].asBool(),
            isHidden = map["isHidden"].asBool(),
            hiddenAt = map["hiddenAt"]?.let { timestampToMillis(it) },
            isPinned = map["isPinned"].asBool(),
            lastReadMessageId = map["lastReadMessageId"] as? String ?: "",
            lastReadAt = map["lastReadAt"]?.let { timestampToMillis(it) } ?: 0,
            unreadCount = (map["unreadCount"] as? Long) ?: 0
        )
    }
}
