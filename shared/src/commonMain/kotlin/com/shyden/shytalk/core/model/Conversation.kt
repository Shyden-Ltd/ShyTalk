package com.shyden.shytalk.core.model

import com.shyden.shytalk.core.util.asBool
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.timestampToMillis

data class ConversationPreview(
    val text: String = "",
    val senderId: String = "",
    val senderName: String = "",
    val createdAt: Long = currentTimeMillis(),
    val type: String = "TEXT"
) {
    fun toMap(): Map<String, Any?> = mapOf(
        "text" to text,
        "senderId" to senderId,
        "senderName" to senderName,
        "createdAt" to createdAt,
        "type" to type
    )

    companion object {
        fun fromMap(map: Map<String, Any?>): ConversationPreview = ConversationPreview(
            text = map["text"] as? String ?: "",
            senderId = map["senderId"] as? String ?: "",
            senderName = map["senderName"] as? String ?: "",
            createdAt = timestampToMillis(map["createdAt"]),
            type = map["type"] as? String ?: "TEXT"
        )
    }
}

data class Conversation(
    val conversationId: String = "",
    val participantIds: List<String> = emptyList(),
    val lastMessage: ConversationPreview? = null,
    val lastMessageAt: Long = currentTimeMillis(),
    val createdAt: Long = currentTimeMillis(),
    // Group chat fields (all default to 1-on-1 behavior)
    val isGroup: Boolean = false,
    val groupName: String? = null,
    val groupPhotoUrl: String? = null,
    val groupAdminIds: List<String> = emptyList(),
    val groupModIds: List<String> = emptyList(),
    val groupDescription: String? = null,
    val createdBy: String? = null,
    val isClosed: Boolean = false,
    val permissions: GroupPermissions = GroupPermissions(),
    val systemMessageConfig: SystemMessageConfig = SystemMessageConfig(),
    val modNotifyMode: String = "ALL_ADMINS"
) {
    val isOneOnOne: Boolean get() = !isGroup

    fun otherUserId(currentUid: String): String? =
        participantIds.firstOrNull { it != currentUid }

    fun isAdmin(userId: String): Boolean =
        groupAdminIds.contains(userId) || createdBy == userId

    fun isMod(userId: String): Boolean = groupModIds.contains(userId)

    fun isModOrAbove(userId: String): Boolean = isMod(userId) || isAdmin(userId)

    fun roleOf(userId: String): GroupRole = when {
        createdBy == userId -> GroupRole.OWNER
        isAdmin(userId) -> GroupRole.ADMIN
        isMod(userId) -> GroupRole.MOD
        else -> GroupRole.MEMBER
    }

    fun toMap(): Map<String, Any?> = buildMap {
        put("conversationId", conversationId)
        put("participantIds", participantIds)
        put("lastMessage", lastMessage?.toMap())
        put("lastMessageAt", lastMessageAt)
        put("createdAt", createdAt)
        put("isGroup", isGroup)
        put("isClosed", isClosed)
        if (isGroup) {
            put("groupName", groupName)
            put("groupPhotoUrl", groupPhotoUrl)
            put("groupAdminIds", groupAdminIds)
            put("groupModIds", groupModIds)
            put("groupDescription", groupDescription)
            put("createdBy", createdBy)
            put("permissions", permissions.toMap())
            put("systemMessageConfig", systemMessageConfig.toMap())
            put("modNotifyMode", modNotifyMode)
        }
    }

    companion object {
        fun generateId(uid1: String, uid2: String): String =
            listOf(uid1, uid2).sorted().joinToString("_")

        @Suppress("UNCHECKED_CAST")
        fun fromMap(map: Map<String, Any?>, conversationId: String): Conversation = Conversation(
            conversationId = conversationId,
            participantIds = (map["participantIds"] as? List<*>)
                ?.filterIsInstance<String>() ?: emptyList(),
            lastMessage = (map["lastMessage"] as? Map<*, *>)?.let { raw ->
                ConversationPreview.fromMap(
                    raw.entries.associate { (k, v) -> k.toString() to v }
                )
            },
            lastMessageAt = timestampToMillis(map["lastMessageAt"]),
            createdAt = timestampToMillis(map["createdAt"]),
            isGroup = map["isGroup"].asBool(),
            groupName = map["groupName"] as? String,
            groupPhotoUrl = map["groupPhotoUrl"] as? String,
            groupAdminIds = (map["groupAdminIds"] as? List<*>)
                ?.filterIsInstance<String>() ?: emptyList(),
            groupModIds = (map["groupModIds"] as? List<*>)
                ?.filterIsInstance<String>() ?: emptyList(),
            groupDescription = map["groupDescription"] as? String,
            createdBy = map["createdBy"] as? String,
            isClosed = map["isClosed"].asBool(),
            permissions = (map["permissions"] as? Map<String, Any?>)?.let {
                GroupPermissions.fromMap(it)
            } ?: GroupPermissions(),
            systemMessageConfig = (map["systemMessageConfig"] as? Map<String, Any?>)?.let {
                SystemMessageConfig.fromMap(it)
            } ?: SystemMessageConfig(),
            modNotifyMode = map["modNotifyMode"] as? String ?: "ALL_ADMINS"
        )
    }
}
