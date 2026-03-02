package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.model.ConversationSettings
import com.shyden.shytalk.core.model.GroupPermissions
import com.shyden.shytalk.core.model.MessageEdit
import com.shyden.shytalk.core.model.MuteInfo
import com.shyden.shytalk.core.model.PrivateMessage
import com.shyden.shytalk.core.model.SystemMessageConfig
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.toMap
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.distinctUntilChanged
import kotlinx.coroutines.flow.flow
import org.json.JSONArray
import org.json.JSONObject

class PrivateMessageRepositoryImpl(
    private val api: WorkerApiClient
) : PrivateMessageRepository {

    @Volatile private var prefetchedConversations: List<Conversation>? = null
    private var conversationCache: List<Conversation>? = null
    private val messageCache = mutableMapOf<String, List<PrivateMessage>>()

    override suspend fun prefetchConversations() {
        try {
            val arr = api.getArray("/api/conversations")
            prefetchedConversations = (0 until arr.length()).map { i ->
                val obj = arr.getJSONObject(i)
                Conversation.fromMap(obj.toMap(), obj.getString("id"))
            }
        } catch (_: Exception) { }
    }

    override fun getConversations(userId: String): Flow<List<Conversation>> = flow {
        // Emit prefetched data (from splash) or cached data from previous collection
        val instant = prefetchedConversations ?: conversationCache
        instant?.let { emit(it) }
        prefetchedConversations = null
        while (true) {
            try {
                val arr = api.getArray("/api/conversations")
                val conversations = (0 until arr.length()).map { i ->
                    val obj = arr.getJSONObject(i)
                    Conversation.fromMap(obj.toMap(), obj.getString("id"))
                }
                conversationCache = conversations
                emit(conversations)
            } catch (_: Exception) { }
            delay(60_000)
        }
    }.distinctUntilChanged()

    override suspend fun getOrCreateConversation(uid1: String, uid2: String): Resource<Conversation> =
        firebaseCall("Failed to get or create conversation") {
            // Server uses request.auth.uid as one participant; pass the other as otherUserId
            val body = JSONObject().apply {
                put("otherUserId", uid2)
            }
            val json = api.post("/api/conversations", body)
            Conversation.fromMap(json.toMap(), json.getString("id"))
        }

    override suspend fun getConversationSettings(
        conversationId: String,
        userId: String
    ): Resource<ConversationSettings> = firebaseCall("Failed to get conversation settings") {
        val json = api.get("/api/conversations/$conversationId/settings")
        ConversationSettings.fromMap(json.toMap(), userId)
    }

    override fun observeConversationSettings(
        conversationId: String,
        userId: String
    ): Flow<ConversationSettings> = flow {
        while (true) {
            try {
                val json = api.get("/api/conversations/$conversationId/settings")
                emit(ConversationSettings.fromMap(json.toMap(), userId))
            } catch (_: Exception) { }
            delay(120_000)
        }
    }.distinctUntilChanged()

    override fun getMessages(conversationId: String, limit: Int): Flow<List<PrivateMessage>> = flow {
        // Emit cached messages instantly so the UI isn't blank on re-open
        messageCache[conversationId]?.let { emit(it) }
        while (true) {
            try {
                val arr = api.getArray("/api/conversations/$conversationId/messages?limit=$limit")
                val messages = (0 until arr.length()).map { i ->
                    val obj = arr.getJSONObject(i)
                    PrivateMessage.fromMap(obj.toMap(), obj.getString("id"))
                }
                messageCache[conversationId] = messages
                emit(messages)
            } catch (_: Exception) { }
            // WebSocket handles the fast path (instant new_message events);
            // this is just a safety-net poll
            delay(60_000)
        }
    }.distinctUntilChanged()

    override suspend fun loadOlderMessages(
        conversationId: String,
        beforeTimestamp: Long,
        limit: Int
    ): Resource<List<PrivateMessage>> = firebaseCall("Failed to load older messages") {
        val arr = api.getArray(
            "/api/conversations/$conversationId/messages/older?before=$beforeTimestamp&limit=$limit"
        )
        (0 until arr.length()).map { i ->
            val obj = arr.getJSONObject(i)
            PrivateMessage.fromMap(obj.toMap(), obj.getString("id"))
        }
    }

    override suspend fun sendTextMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        text: String,
        replyToMessageId: String?,
        replyToText: String?,
        replyToSenderName: String?
    ): Resource<Unit> = firebaseCall("Failed to send message") {
        val body = JSONObject().apply {
            put("senderId", senderId)
            put("senderName", senderName)
            put("text", text)
            put("type", "TEXT")
            replyToMessageId?.let { put("replyToMessageId", it) }
            replyToText?.let { put("replyToText", it) }
            replyToSenderName?.let { put("replyToSenderName", it) }
        }
        api.post("/api/conversations/$conversationId/messages", body)
    }

    override suspend fun sendImageMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        imageUrls: List<String>,
        replyToMessageId: String?,
        replyToText: String?,
        replyToSenderName: String?
    ): Resource<Unit> = firebaseCall("Failed to send image message") {
        val body = JSONObject().apply {
            put("senderId", senderId)
            put("senderName", senderName)
            put("text", "")
            put("type", "IMAGE")
            put("imageUrls", JSONArray(imageUrls))
            replyToMessageId?.let { put("replyToMessageId", it) }
            replyToText?.let { put("replyToText", it) }
            replyToSenderName?.let { put("replyToSenderName", it) }
        }
        api.post("/api/conversations/$conversationId/messages", body)
    }

    override suspend fun editMessage(
        conversationId: String,
        messageId: String,
        newText: String
    ): Resource<Unit> = firebaseCall("Failed to edit message") {
        val body = JSONObject().apply { put("text", newText) }
        api.patch("/api/conversations/$conversationId/messages/$messageId", body)
    }

    override suspend fun getEditHistory(
        conversationId: String,
        messageId: String
    ): Resource<List<MessageEdit>> = firebaseCall("Failed to get edit history") {
        val arr = api.getArray("/api/conversations/$conversationId/messages/$messageId/edits")
        (0 until arr.length()).map { i ->
            val obj = arr.getJSONObject(i)
            MessageEdit.fromMap(obj.toMap(), obj.getString("id"))
        }
    }

    override suspend fun markAsRead(
        conversationId: String,
        userId: String,
        messageId: String
    ): Resource<Unit> = firebaseCall("Failed to mark as read") {
        val body = JSONObject().apply { put("messageId", messageId) }
        api.post("/api/conversations/$conversationId/read", body)
    }

    override suspend fun resetUnreadCount(
        conversationId: String,
        userId: String
    ): Resource<Unit> = firebaseCall("Failed to reset unread count") {
        api.post("/api/conversations/$conversationId/reset-unread")
    }

    override suspend fun muteConversation(
        conversationId: String,
        userId: String,
        muted: Boolean
    ): Resource<Unit> = firebaseCall("Failed to mute conversation") {
        val body = JSONObject().apply { put("isMuted", muted) }
        api.patch("/api/conversations/$conversationId/settings", body)
    }

    override suspend fun pinConversation(
        conversationId: String,
        userId: String,
        pinned: Boolean
    ): Resource<Unit> = firebaseCall("Failed to pin conversation") {
        val body = JSONObject().apply { put("isPinned", pinned) }
        api.patch("/api/conversations/$conversationId/settings", body)
    }

    override suspend fun hideConversation(
        conversationId: String,
        userId: String
    ): Resource<Unit> = firebaseCall("Failed to hide conversation") {
        val body = JSONObject().apply { put("isHidden", true) }
        api.patch("/api/conversations/$conversationId/settings", body)
    }

    override suspend fun toggleReaction(
        conversationId: String,
        messageId: String,
        emoji: String,
        userId: String
    ): Resource<Unit> = firebaseCall("Failed to toggle reaction") {
        val body = JSONObject().apply {
            put("emoji", emoji)
            put("userId", userId)
        }
        api.post("/api/conversations/$conversationId/messages/$messageId/react", body)
    }

    override suspend fun searchMessages(
        conversationId: String,
        query: String
    ): Resource<List<PrivateMessage>> = firebaseCall("Failed to search messages") {
        val arr = api.getArray("/api/conversations/search-messages?conversationId=$conversationId&q=$query")
        (0 until arr.length()).map { i ->
            val obj = arr.getJSONObject(i)
            PrivateMessage.fromMap(obj.toMap(), obj.getString("id"))
        }
    }

    override suspend fun createGroupConversation(
        creatorId: String,
        participantIds: List<String>,
        groupName: String,
        groupDescription: String?,
        groupPhotoUrl: String?,
        adminIds: List<String>,
        modIds: List<String>,
        permissions: GroupPermissions,
        systemMessageConfig: SystemMessageConfig
    ): Resource<Conversation> = firebaseCall("Failed to create group conversation") {
        val body = JSONObject().apply {
            put("creatorId", creatorId)
            put("participantIds", JSONArray(participantIds))
            put("groupName", groupName)
            groupDescription?.let { put("groupDescription", it) }
            groupPhotoUrl?.let { put("groupPhotoUrl", it) }
            put("adminIds", JSONArray(adminIds))
            put("modIds", JSONArray(modIds))
            put("permissions", JSONObject(permissions.toMap()))
            put("systemMessageConfig", JSONObject(systemMessageConfig.toMap()))
        }
        val json = api.post("/api/conversations/group", body)
        Conversation.fromMap(json.toMap(), json.getString("id"))
    }

    override suspend fun addGroupParticipant(
        conversationId: String,
        userId: String
    ): Resource<Unit> = firebaseCall("Failed to add participant") {
        val body = JSONObject().apply { put("userId", userId) }
        api.post("/api/conversations/$conversationId/participants/add", body)
    }

    override suspend fun removeGroupParticipant(
        conversationId: String,
        userId: String
    ): Resource<Unit> = firebaseCall("Failed to remove participant") {
        val body = JSONObject().apply { put("userId", userId) }
        api.post("/api/conversations/$conversationId/participants/remove", body)
    }

    override suspend fun updateGroupName(
        conversationId: String,
        newName: String
    ): Resource<Unit> = firebaseCall("Failed to update group name") {
        val body = JSONObject().apply { put("groupName", newName) }
        api.patch("/api/conversations/$conversationId/group", body)
    }

    override suspend fun sendStickerMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        stickerUrl: String
    ): Resource<Unit> = firebaseCall("Failed to send sticker") {
        val body = JSONObject().apply {
            put("senderId", senderId)
            put("senderName", senderName)
            put("text", "")
            put("type", "STICKER")
            put("stickerUrl", stickerUrl)
        }
        api.post("/api/conversations/$conversationId/messages", body)
    }

    override suspend fun sendRoomInviteMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        roomId: String,
        roomName: String
    ): Resource<Unit> = firebaseCall("Failed to send room invite") {
        val body = JSONObject().apply {
            put("senderId", senderId)
            put("senderName", senderName)
            put("text", "")
            put("type", "ROOM_INVITE")
            put("roomInviteId", roomId)
            put("roomInviteName", roomName)
        }
        api.post("/api/conversations/$conversationId/messages", body)
    }

    override suspend fun getModerationConfig(): Resource<List<String>> =
        firebaseCall("Failed to load moderation config") {
            val json = api.get("/api/config/moderation")
            val arr = json.optJSONArray("prohibitedWords") ?: JSONArray()
            (0 until arr.length()).map { arr.getString(it) }
        }

    override suspend fun getConversation(conversationId: String): Resource<Conversation> =
        firebaseCall("Failed to get conversation") {
            val json = api.get("/api/conversations/$conversationId")
            Conversation.fromMap(json.toMap(), json.getString("id"))
        }

    override suspend fun closeGroupConversation(conversationId: String): Resource<Unit> =
        firebaseCall("Failed to close group conversation") {
            api.patch("/api/conversations/$conversationId/close", JSONObject())
        }

    override suspend fun recallMessage(
        conversationId: String,
        messageId: String
    ): Resource<Unit> = firebaseCall("Failed to recall message") {
        api.post("/api/conversations/$conversationId/messages/$messageId/recall", JSONObject())
    }

    // ===== Mod Actions =====

    override suspend fun muteGroupMember(
        conversationId: String,
        userId: String,
        duration: Long?,
        reason: String?
    ): Resource<Unit> = firebaseCall("Failed to mute member") {
        val body = JSONObject().apply {
            duration?.let { put("duration", it) }
            reason?.let { put("reason", it) }
        }
        api.post("/api/conversations/$conversationId/mutes/$userId", body)
    }

    override suspend fun unmuteGroupMember(
        conversationId: String,
        userId: String
    ): Resource<Unit> = firebaseCall("Failed to unmute member") {
        api.delete("/api/conversations/$conversationId/mutes/$userId")
    }

    override suspend fun getGroupMutes(
        conversationId: String
    ): Resource<List<MuteInfo>> = firebaseCall("Failed to get mutes") {
        val arr = api.getArray("/api/conversations/$conversationId/mutes")
        (0 until arr.length()).map { i ->
            val obj = arr.getJSONObject(i)
            @Suppress("UNCHECKED_CAST")
            MuteInfo.fromMap(obj.toMap() as Map<String, Any?>, obj.getString("userId"))
        }
    }

    override suspend fun hideMessage(
        conversationId: String,
        messageId: String,
        hiddenBy: String
    ): Resource<Unit> = firebaseCall("Failed to hide message") {
        val body = JSONObject().apply { put("hiddenBy", hiddenBy) }
        api.post("/api/conversations/$conversationId/messages/$messageId/hide", body)
    }

    // ===== Role Management =====

    override suspend fun updateGroupRoles(
        conversationId: String,
        adminIds: List<String>,
        modIds: List<String>
    ): Resource<Unit> = firebaseCall("Failed to update roles") {
        val body = JSONObject().apply {
            put("adminIds", JSONArray(adminIds))
            put("modIds", JSONArray(modIds))
        }
        api.patch("/api/conversations/$conversationId/roles", body)
    }

    override suspend fun transferOwnership(
        conversationId: String,
        newOwnerId: String
    ): Resource<Unit> = firebaseCall("Failed to transfer ownership") {
        val body = JSONObject().apply { put("newOwnerId", newOwnerId) }
        api.post("/api/conversations/$conversationId/transfer-ownership", body)
    }

    // ===== Permissions =====

    override suspend fun updateGroupPermissions(
        conversationId: String,
        permissions: GroupPermissions
    ): Resource<Unit> = firebaseCall("Failed to update permissions") {
        api.patch("/api/conversations/$conversationId/permissions", JSONObject(permissions.toMap()))
    }

    override suspend fun updateSystemMessageConfig(
        conversationId: String,
        config: SystemMessageConfig
    ): Resource<Unit> = firebaseCall("Failed to update system message config") {
        api.patch("/api/conversations/$conversationId/system-messages", JSONObject(config.toMap()))
    }

    override suspend fun updateModNotifyMode(
        conversationId: String,
        mode: String
    ): Resource<Unit> = firebaseCall("Failed to update mod notify mode") {
        val body = JSONObject().apply { put("modNotifyMode", mode) }
        api.patch("/api/conversations/$conversationId/mod-notify", body)
    }

    // ===== Group Info =====

    override suspend fun updateGroupDescription(
        conversationId: String,
        description: String
    ): Resource<Unit> = firebaseCall("Failed to update description") {
        val body = JSONObject().apply { put("groupDescription", description) }
        api.patch("/api/conversations/$conversationId/group", body)
    }

    override suspend fun updateGroupPhoto(
        conversationId: String,
        photoUrl: String?
    ): Resource<Unit> = firebaseCall("Failed to update group photo") {
        val body = JSONObject().apply { put("groupPhotoUrl", photoUrl ?: JSONObject.NULL) }
        api.patch("/api/conversations/$conversationId/group", body)
    }

    // ===== Search =====

    override suspend fun searchUsers(
        query: String,
        currentUserId: String
    ): Resource<List<User>> = firebaseCall("Failed to search users") {
        val arr = api.getArray("/api/conversations/search-users?q=$query")
        (0 until arr.length()).map { i ->
            val obj = arr.getJSONObject(i)
            @Suppress("UNCHECKED_CAST")
            User.fromMap(obj.toMap() as Map<String, Any?>, obj.getString("uid"))
        }
    }

    // ===== Counting =====

    override suspend fun getOwnedGroupCount(
        userId: String
    ): Resource<Int> = firebaseCall("Failed to get owned group count") {
        val json = api.get("/api/conversations/owned-group-count")
        json.getInt("count")
    }
}
