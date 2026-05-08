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
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.firestore.dataMap
import com.shyden.shytalk.data.remote.IosApiClient
import dev.gitlive.firebase.firestore.Direction
import dev.gitlive.firebase.firestore.FieldValue
import dev.gitlive.firebase.firestore.FirebaseFirestore
import kotlinx.coroutines.CancellationException
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.map
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive

private const val TAG = "PMRepository"

class IosPrivateMessageRepositoryImpl(
    private val api: IosApiClient,
    private val firestore: FirebaseFirestore,
    private val authRepository: AuthRepository,
) : PrivateMessageRepository {
    @kotlin.concurrent.Volatile
    private var prefetchedConversations: List<Conversation>? = null

    override suspend fun prefetchConversations() {
        try {
            val uid = authRepository.currentUserId ?: return
            // participantIds is stored as STRINGS in Firestore (set by Express API
            // and the create-conversation path below). Querying with a Long would
            // miss every document AND trigger a Firestore rule evaluation error
            // for `string(callerUniqueId()) in resource.data.participantIds`.
            val snapshot =
                firestore
                    .collection("conversations")
                    .where { "participantIds" contains uid }
                    .orderBy("lastMessageAt", Direction.DESCENDING)
                    .get()
            prefetchedConversations =
                snapshot.documents.mapNotNull { doc ->
                    try {
                        val data = doc.dataMap()
                        Conversation.fromMap(data, doc.id)
                    } catch (e: Exception) {
                        null
                    }
                }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            logW(TAG, "Failed to prefetch conversations")
        }
    }

    override fun getConversations(userId: String): Flow<List<Conversation>> {
        // See prefetchConversations: participantIds is stored as strings.
        return firestore
            .collection("conversations")
            .where { "participantIds" contains userId }
            .orderBy("lastMessageAt", Direction.DESCENDING)
            .snapshots
            .map { snapshot ->
                snapshot.documents.mapNotNull { doc ->
                    try {
                        val data = doc.dataMap()
                        Conversation.fromMap(data, doc.id)
                    } catch (e: Exception) {
                        null
                    }
                }
            }
    }

    override suspend fun getOrCreateConversation(
        uid1: String,
        uid2: String,
    ): Resource<Conversation> =
        firebaseCall("Failed to get or create conversation") {
            val conversationId = Conversation.generateId(uid1, uid2)
            val docRef = firestore.collection("conversations").document(conversationId)
            val doc = docRef.get()
            if (doc.exists) {
                val data = doc.dataMap()
                Conversation.fromMap(data, conversationId)
            } else {
                val now = currentTimeMillis()
                val data =
                    mapOf(
                        // Strings (matches Express API + Firestore rules format)
                        "participantIds" to listOf(uid1, uid2).sorted(),
                        "isGroup" to false,
                        "createdAt" to now,
                        "lastMessageAt" to now,
                        "isClosed" to false,
                    )
                docRef.set(data)
                Conversation.fromMap(data, conversationId)
            }
        }

    override suspend fun getConversationSettings(
        conversationId: String,
        userId: String,
    ): Resource<ConversationSettings> =
        firebaseCall("Failed to get conversation settings") {
            val doc =
                firestore
                    .collection("conversations/$conversationId/userSettings")
                    .document(userId)
                    .get()
            if (!doc.exists) return@firebaseCall ConversationSettings.default(userId)
            val data = doc.dataMap()
            ConversationSettings.fromMap(data, userId)
        }

    override fun observeConversationSettings(
        conversationId: String,
        userId: String,
    ): Flow<ConversationSettings> =
        firestore
            .collection("conversations/$conversationId/userSettings")
            .document(userId)
            .snapshots
            .map { snapshot ->
                if (!snapshot.exists) {
                    ConversationSettings.default(userId)
                } else {
                    val data = snapshot.dataMap()
                    ConversationSettings.fromMap(data, userId)
                }
            }

    override fun getMessages(
        conversationId: String,
        limit: Int,
    ): Flow<List<PrivateMessage>> =
        firestore
            .collection("conversations/$conversationId/messages")
            .orderBy("createdAt", Direction.DESCENDING)
            .limit(limit)
            .snapshots
            .map { snapshot ->
                snapshot.documents
                    .mapNotNull { doc ->
                        try {
                            val data = doc.dataMap()
                            PrivateMessage.fromMap(data, doc.id)
                        } catch (e: Exception) {
                            null
                        }
                    }.reversed()
            }

    override suspend fun loadOlderMessages(
        conversationId: String,
        beforeTimestamp: Long,
        limit: Int,
    ): Resource<List<PrivateMessage>> =
        firebaseCall("Failed to load older messages") {
            val snapshot =
                firestore
                    .collection("conversations/$conversationId/messages")
                    .orderBy("createdAt", Direction.DESCENDING)
                    .where { "createdAt" lessThan beforeTimestamp }
                    .limit(limit)
                    .get()
            snapshot.documents
                .mapNotNull { doc ->
                    try {
                        val data = doc.dataMap()
                        PrivateMessage.fromMap(data, doc.id)
                    } catch (e: Exception) {
                        null
                    }
                }.reversed()
        }

    // ── Send methods (Express API for FCM push) ─────────────────

    override suspend fun sendTextMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        text: String,
        replyToMessageId: String?,
        replyToText: String?,
        replyToSenderName: String?,
    ): Resource<Unit> =
        firebaseCall("Failed to send message") {
            val fields =
                mutableMapOf<String, kotlinx.serialization.json.JsonElement>(
                    "senderId" to JsonPrimitive(senderId),
                    "senderName" to JsonPrimitive(senderName),
                    "text" to JsonPrimitive(text),
                    "type" to JsonPrimitive("TEXT"),
                )
            replyToMessageId?.let { fields["replyToMessageId"] = JsonPrimitive(it) }
            replyToText?.let { fields["replyToText"] = JsonPrimitive(it) }
            replyToSenderName?.let { fields["replyToSenderName"] = JsonPrimitive(it) }
            api.post("/api/conversations/$conversationId/messages", JsonObject(fields))
        }

    override suspend fun sendImageMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        imageUrls: List<String>,
        replyToMessageId: String?,
        replyToText: String?,
        replyToSenderName: String?,
    ): Resource<Unit> =
        firebaseCall("Failed to send image message") {
            val fields =
                mutableMapOf<String, kotlinx.serialization.json.JsonElement>(
                    "senderId" to JsonPrimitive(senderId),
                    "senderName" to JsonPrimitive(senderName),
                    "text" to JsonPrimitive(""),
                    "type" to JsonPrimitive("IMAGE"),
                    "imageUrls" to JsonArray(imageUrls.map { JsonPrimitive(it) }),
                )
            replyToMessageId?.let { fields["replyToMessageId"] = JsonPrimitive(it) }
            replyToText?.let { fields["replyToText"] = JsonPrimitive(it) }
            replyToSenderName?.let { fields["replyToSenderName"] = JsonPrimitive(it) }
            api.post("/api/conversations/$conversationId/messages", JsonObject(fields))
        }

    override suspend fun sendStickerMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        stickerUrl: String,
    ): Resource<Unit> =
        firebaseCall("Failed to send sticker") {
            api.post(
                "/api/conversations/$conversationId/messages",
                JsonObject(
                    mapOf(
                        "senderId" to JsonPrimitive(senderId),
                        "senderName" to JsonPrimitive(senderName),
                        "text" to JsonPrimitive(""),
                        "type" to JsonPrimitive("STICKER"),
                        "stickerUrl" to JsonPrimitive(stickerUrl),
                    ),
                ),
            )
        }

    override suspend fun sendRoomInviteMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        roomId: String,
        roomName: String,
    ): Resource<Unit> =
        firebaseCall("Failed to send room invite") {
            api.post(
                "/api/conversations/$conversationId/messages",
                JsonObject(
                    mapOf(
                        "senderId" to JsonPrimitive(senderId),
                        "senderName" to JsonPrimitive(senderName),
                        "text" to JsonPrimitive(""),
                        "type" to JsonPrimitive("ROOM_INVITE"),
                        "roomInviteId" to JsonPrimitive(roomId),
                        "roomInviteName" to JsonPrimitive(roomName),
                    ),
                ),
            )
        }

    // ── Direct Firestore writes ─────────────────────────────────

    override suspend fun editMessage(
        conversationId: String,
        messageId: String,
        newText: String,
    ): Resource<Unit> =
        firebaseCall("Failed to edit message") {
            val messageRef =
                firestore
                    .collection("conversations/$conversationId/messages")
                    .document(messageId)
            val currentDoc = messageRef.get()
            val currentText = currentDoc.get<String>("text")
            val now = currentTimeMillis()

            val editRef = messageRef.collection("edits").document
            val batch = firestore.batch()
            batch.set(editRef, mapOf("previousText" to currentText, "editedAt" to now))
            batch.updateFields(messageRef) {
                "text" to newText
                "isEdited" to true
                "editedAt" to now
                "editCount" to FieldValue.increment(1)
            }
            batch.commit()
        }

    override suspend fun getEditHistory(
        conversationId: String,
        messageId: String,
    ): Resource<List<MessageEdit>> =
        firebaseCall("Failed to get edit history") {
            val snapshot =
                firestore
                    .collection("conversations/$conversationId/messages/$messageId/edits")
                    .orderBy("editedAt", Direction.ASCENDING)
                    .get()
            snapshot.documents.mapNotNull { doc ->
                try {
                    val data = doc.dataMap()
                    MessageEdit.fromMap(data, doc.id)
                } catch (e: Exception) {
                    null
                }
            }
        }

    override suspend fun markAsRead(
        conversationId: String,
        userId: String,
        messageId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to mark as read") {
            firestore
                .collection("conversations/$conversationId/userSettings")
                .document(userId)
                .set(
                    mapOf(
                        "lastReadMessageId" to messageId,
                        "unreadCount" to 0,
                        "lastReadAt" to currentTimeMillis(),
                    ),
                    merge = true,
                )
        }

    override suspend fun resetUnreadCount(
        conversationId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to reset unread count") {
            firestore
                .collection("conversations/$conversationId/userSettings")
                .document(userId)
                .set(mapOf("unreadCount" to 0), merge = true)
        }

    override suspend fun muteConversation(
        conversationId: String,
        userId: String,
        muted: Boolean,
    ): Resource<Unit> =
        firebaseCall("Failed to mute conversation") {
            firestore
                .collection("conversations/$conversationId/userSettings")
                .document(userId)
                .set(mapOf("isMuted" to muted), merge = true)
        }

    override suspend fun pinConversation(
        conversationId: String,
        userId: String,
        pinned: Boolean,
    ): Resource<Unit> =
        firebaseCall("Failed to pin conversation") {
            firestore
                .collection("conversations/$conversationId/userSettings")
                .document(userId)
                .set(mapOf("isPinned" to pinned), merge = true)
        }

    override suspend fun hideConversation(
        conversationId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to hide conversation") {
            firestore
                .collection("conversations/$conversationId/userSettings")
                .document(userId)
                .set(
                    mapOf("isHidden" to true, "hiddenAt" to currentTimeMillis()),
                    merge = true,
                )
        }

    override suspend fun toggleReaction(
        conversationId: String,
        messageId: String,
        emoji: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to toggle reaction") {
            val messageRef =
                firestore
                    .collection("conversations/$conversationId/messages")
                    .document(messageId)
            firestore.runTransaction {
                val doc = get(messageRef)
                val data = doc.dataMap()

                @Suppress("UNCHECKED_CAST")
                val reactions =
                    (data["reactions"] as? Map<String, List<String>>)?.toMutableMap()
                        ?: mutableMapOf()
                val usersForEmoji = reactions[emoji]?.toMutableList() ?: mutableListOf()
                if (userId in usersForEmoji) {
                    usersForEmoji.remove(userId)
                    if (usersForEmoji.isEmpty()) {
                        reactions.remove(emoji)
                    } else {
                        reactions[emoji] = usersForEmoji
                    }
                } else {
                    usersForEmoji.add(userId)
                    reactions[emoji] = usersForEmoji
                }
                updateFields(messageRef) { "reactions" to reactions }
            }
        }

    override suspend fun searchMessages(
        conversationId: String,
        query: String,
    ): Resource<List<PrivateMessage>> =
        firebaseCall("Failed to search messages") {
            val snapshot =
                firestore
                    .collection("conversations/$conversationId/messages")
                    .orderBy("createdAt", Direction.DESCENDING)
                    .limit(500)
                    .get()
            val lowerQuery = query.lowercase()
            snapshot.documents.mapNotNull { doc ->
                try {
                    val data = doc.dataMap()
                    val message = PrivateMessage.fromMap(data, doc.id)
                    if (message.text.lowercase().contains(lowerQuery)) message else null
                } catch (e: Exception) {
                    null
                }
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
        systemMessageConfig: SystemMessageConfig,
    ): Resource<Conversation> =
        firebaseCall("Failed to create group conversation") {
            val docRef = firestore.collection("conversations").document
            val now = currentTimeMillis()
            val data =
                mutableMapOf<String, Any?>(
                    "participantIds" to participantIds,
                    "isGroup" to true,
                    "groupName" to groupName,
                    "createdBy" to creatorId,
                    "createdAt" to now,
                    "lastMessageAt" to now,
                    "isClosed" to false,
                    "groupAdminIds" to adminIds,
                    "groupModIds" to modIds,
                    "permissions" to permissions.toMap(),
                    "systemMessageConfig" to systemMessageConfig.toMap(),
                    "modNotifyMode" to "ALL_ADMINS",
                )
            groupDescription?.let { data["groupDescription"] = it }
            groupPhotoUrl?.let { data["groupPhotoUrl"] = it }
            docRef.set(data)
            val batch = firestore.batch()
            for (pid in participantIds) {
                val settingsRef = docRef.collection("userSettings").document(pid)
                batch.set(settingsRef, mapOf("unreadCount" to 0, "userId" to pid))
            }
            batch.commit()
            Conversation.fromMap(data, docRef.id)
        }

    override suspend fun addGroupParticipant(
        conversationId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to add participant") {
            firestore.collection("conversations").document(conversationId).updateFields {
                "participantIds" to FieldValue.arrayUnion(userId)
            }
        }

    override suspend fun removeGroupParticipant(
        conversationId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to remove participant") {
            firestore.collection("conversations").document(conversationId).updateFields {
                "participantIds" to FieldValue.arrayRemove(userId)
            }
        }

    override suspend fun updateGroupName(
        conversationId: String,
        newName: String,
    ): Resource<Unit> =
        firebaseCall("Failed to update group name") {
            firestore.collection("conversations").document(conversationId).updateFields {
                "groupName" to newName
            }
        }

    override suspend fun getModerationConfig(): Resource<List<String>> =
        firebaseCall("Failed to load moderation config") {
            val doc = firestore.collection("config").document("moderation").get()
            if (!doc.exists) return@firebaseCall emptyList()
            val data = doc.dataMap()
            (data["prohibitedWords"] as? List<*>)?.filterIsInstance<String>() ?: emptyList()
        }

    override suspend fun getConversation(conversationId: String): Resource<Conversation> =
        firebaseCall("Failed to get conversation") {
            val doc = firestore.collection("conversations").document(conversationId).get()
            if (!doc.exists) throw Exception("Conversation not found")
            val data = doc.dataMap()
            Conversation.fromMap(data, conversationId)
        }

    override suspend fun closeGroupConversation(conversationId: String): Resource<Unit> =
        firebaseCall("Failed to close group conversation") {
            firestore.collection("conversations").document(conversationId).updateFields {
                "isClosed" to true
            }
        }

    override suspend fun recallMessage(
        conversationId: String,
        messageId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to recall message") {
            firestore.collection("conversations/$conversationId/messages").document(messageId).updateFields {
                "isRecalled" to true
                "text" to ""
            }
        }

    // ── Mod Actions ─────────────────────────────────────────────

    override suspend fun muteGroupMember(
        conversationId: String,
        userId: String,
        duration: Long?,
        reason: String?,
    ): Resource<Unit> =
        firebaseCall("Failed to mute member") {
            val now = currentTimeMillis()
            val data =
                mutableMapOf<String, Any?>(
                    "userId" to userId,
                    "mutedAt" to now,
                )
            duration?.let { data["duration"] = it }
            reason?.let { data["reason"] = it }
            firestore
                .collection("conversations/$conversationId/mutes")
                .document(userId)
                .set(data)
        }

    override suspend fun unmuteGroupMember(
        conversationId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to unmute member") {
            firestore
                .collection("conversations/$conversationId/mutes")
                .document(userId)
                .delete()
        }

    override suspend fun getGroupMutes(conversationId: String): Resource<List<MuteInfo>> =
        firebaseCall("Failed to get mutes") {
            val snapshot =
                firestore
                    .collection("conversations/$conversationId/mutes")
                    .get()
            snapshot.documents.mapNotNull { doc ->
                try {
                    val data = doc.dataMap()
                    MuteInfo.fromMap(data, doc.id)
                } catch (e: Exception) {
                    null
                }
            }
        }

    override suspend fun hideMessage(
        conversationId: String,
        messageId: String,
        hiddenBy: String,
    ): Resource<Unit> =
        firebaseCall("Failed to hide message") {
            firestore.collection("conversations/$conversationId/messages").document(messageId).updateFields {
                "isHidden" to true
                "hiddenBy" to hiddenBy
            }
        }

    // ── Role Management ─────────────────────────────────────────

    override suspend fun updateGroupRoles(
        conversationId: String,
        adminIds: List<String>,
        modIds: List<String>,
    ): Resource<Unit> =
        firebaseCall("Failed to update roles") {
            firestore.collection("conversations").document(conversationId).updateFields {
                "groupAdminIds" to adminIds
                "groupModIds" to modIds
            }
        }

    override suspend fun transferOwnership(
        conversationId: String,
        newOwnerId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to transfer ownership") {
            firestore.collection("conversations").document(conversationId).updateFields {
                "createdBy" to newOwnerId
            }
        }

    // ── Permissions ─────────────────────────────────────────────

    override suspend fun updateGroupPermissions(
        conversationId: String,
        permissions: GroupPermissions,
    ): Resource<Unit> =
        firebaseCall("Failed to update permissions") {
            firestore.collection("conversations").document(conversationId).updateFields {
                "permissions" to permissions.toMap()
            }
        }

    override suspend fun updateSystemMessageConfig(
        conversationId: String,
        config: SystemMessageConfig,
    ): Resource<Unit> =
        firebaseCall("Failed to update system message config") {
            firestore.collection("conversations").document(conversationId).updateFields {
                "systemMessageConfig" to config.toMap()
            }
        }

    override suspend fun updateModNotifyMode(
        conversationId: String,
        mode: String,
    ): Resource<Unit> =
        firebaseCall("Failed to update mod notify mode") {
            firestore.collection("conversations").document(conversationId).updateFields {
                "modNotifyMode" to mode
            }
        }

    // ── Group Info ───────────────────────────────────────────────

    override suspend fun updateGroupDescription(
        conversationId: String,
        description: String,
    ): Resource<Unit> =
        firebaseCall("Failed to update description") {
            firestore.collection("conversations").document(conversationId).updateFields {
                "groupDescription" to description
            }
        }

    override suspend fun updateGroupPhoto(
        conversationId: String,
        photoUrl: String?,
    ): Resource<Unit> =
        firebaseCall("Failed to update group photo") {
            firestore.collection("conversations").document(conversationId).updateFields {
                "groupPhotoUrl" to photoUrl
            }
        }

    // ── Search ──────────────────────────────────────────────────

    override suspend fun searchUsers(
        query: String,
        currentUserId: String,
    ): Resource<List<User>> =
        firebaseCall("Failed to search users") {
            val snapshot =
                firestore
                    .collection("users")
                    .where {
                        all(
                            "displayName" greaterThanOrEqualTo query,
                            "displayName" lessThan query + "\uf8ff",
                        )
                    }.get()
            snapshot.documents.mapNotNull { doc ->
                if (doc.id == currentUserId) return@mapNotNull null
                try {
                    val data = doc.dataMap()
                    User.fromMap(data, doc.id)
                } catch (e: Exception) {
                    null
                }
            }
        }

    // ── Counting ────────────────────────────────────────────────

    override suspend fun getOwnedGroupCount(userId: String): Resource<Int> =
        firebaseCall("Failed to get owned group count") {
            val snapshot =
                firestore
                    .collection("conversations")
                    .where {
                        all(
                            "createdBy" equalTo userId,
                            "isGroup" equalTo true,
                        )
                    }.get()
            snapshot.documents.count { doc ->
                try {
                    val data = doc.dataMap()
                    (data["isClosed"] as? Boolean) != true
                } catch (e: Exception) {
                    false
                }
            }
        }
}
