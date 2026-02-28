package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.asBool
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.timestampToMillis

enum class PrivateMessageType {
    TEXT,
    IMAGE,
    STICKER,
    ROOM_INVITE,
    MOD_ACTION,
    SYSTEM
}

enum class SendStatus {
    SENT,
    SENDING,
    FAILED
}

data class PrivateMessage(
    val messageId: String = "",
    val senderId: String = "",
    val senderName: String = "",
    val text: String = "",
    val imageUrls: List<String> = emptyList(),
    val type: PrivateMessageType = PrivateMessageType.TEXT,
    val createdAt: Long = currentTimeMillis(),
    val editedAt: Long? = null,
    val editCount: Long = 0,
    val readBy: List<String> = emptyList(),
    val replyToMessageId: String? = null,
    val replyToText: String? = null,
    val replyToSenderName: String? = null,
    val stickerUrl: String? = null,
    val roomInviteId: String? = null,
    val roomInviteName: String? = null,
    // Reactions: emoji -> list of user IDs
    val reactions: Map<String, List<String>> = emptyMap(),
    val isRecalled: Boolean = false,
    val isHidden: Boolean = false,
    val hiddenBy: String? = null,
    // Client-side only
    val sendStatus: SendStatus = SendStatus.SENT,
    val localImageData: List<ByteArray> = emptyList()
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "messageId" to messageId,
        "senderId" to senderId,
        "senderName" to senderName,
        "text" to text,
        "imageUrls" to imageUrls,
        "type" to type.name,
        "createdAt" to createdAt,
        "editedAt" to editedAt,
        "editCount" to editCount,
        "readBy" to readBy,
        "replyToMessageId" to replyToMessageId,
        "replyToText" to replyToText,
        "replyToSenderName" to replyToSenderName,
        "stickerUrl" to stickerUrl,
        "roomInviteId" to roomInviteId,
        "roomInviteName" to roomInviteName,
        "reactions" to reactions,
        "isRecalled" to isRecalled,
        "isHidden" to isHidden,
        "hiddenBy" to hiddenBy
    )

    companion object {
        fun fromMap(map: Map<String, Any?>, messageId: String): PrivateMessage = PrivateMessage(
            messageId = messageId,
            senderId = map["senderId"] as? String ?: "",
            senderName = map["senderName"] as? String ?: "",
            text = map["text"] as? String ?: "",
            imageUrls = (map["imageUrls"] as? List<*>)
                ?.filterIsInstance<String>() ?: emptyList(),
            type = (map["type"] as? String)?.let {
                try { PrivateMessageType.valueOf(it) } catch (_: Exception) { PrivateMessageType.TEXT }
            } ?: PrivateMessageType.TEXT,
            createdAt = timestampToMillis(map["createdAt"] ?: map["timestamp"]),
            editedAt = map["editedAt"]?.let { timestampToMillis(it) },
            editCount = (map["editCount"] as? Long) ?: 0,
            readBy = (map["readBy"] as? List<*>)
                ?.filterIsInstance<String>() ?: emptyList(),
            replyToMessageId = map["replyToMessageId"] as? String,
            replyToText = map["replyToText"] as? String,
            replyToSenderName = map["replyToSenderName"] as? String,
            stickerUrl = map["stickerUrl"] as? String,
            roomInviteId = map["roomInviteId"] as? String,
            roomInviteName = map["roomInviteName"] as? String,
            reactions = (map["reactions"] as? Map<*, *>)?.mapNotNull { (key, value) ->
                val emoji = key as? String ?: return@mapNotNull null
                val users = (value as? List<*>)?.filterIsInstance<String>() ?: return@mapNotNull null
                emoji to users
            }?.toMap() ?: emptyMap(),
            isRecalled = map["isRecalled"].asBool(),
            isHidden = map["isHidden"].asBool(),
            hiddenBy = map["hiddenBy"] as? String
        )
    }
}
