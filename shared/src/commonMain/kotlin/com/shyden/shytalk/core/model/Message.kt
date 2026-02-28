package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.asBool
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.timestampToMillis

enum class MessageType {
    TEXT,
    SYSTEM,
    JOIN,
    GIFT
}

data class Message(
    val messageId: String = "",
    val senderId: String = "",
    val senderName: String = "",
    val text: String = "",
    val createdAt: Long = currentTimeMillis(),
    val type: MessageType = MessageType.TEXT,
    val isEdited: Boolean = false,
    val giftId: String = "",
    val giftIconUrl: String = ""
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "messageId" to messageId,
        "senderId" to senderId,
        "senderName" to senderName,
        "text" to text,
        "createdAt" to createdAt,
        "type" to type.name,
        "isEdited" to isEdited,
        "giftId" to giftId,
        "giftIconUrl" to giftIconUrl
    )

    companion object {
        fun fromMap(map: Map<String, Any?>, messageId: String): Message = Message(
            messageId = messageId,
            senderId = map["senderId"] as? String ?: "",
            senderName = map["senderName"] as? String ?: "",
            text = map["text"] as? String ?: "",
            createdAt = timestampToMillis(map["createdAt"]),
            type = (map["type"] as? String)?.let {
                try { MessageType.valueOf(it) } catch (_: Exception) { MessageType.TEXT }
            } ?: MessageType.TEXT,
            isEdited = map["isEdited"].asBool(),
            giftId = map["giftId"] as? String ?: "",
            giftIconUrl = map["giftIconUrl"] as? String ?: ""
        )
    }
}
