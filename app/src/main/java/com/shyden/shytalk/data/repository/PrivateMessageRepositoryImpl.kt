package com.shyden.shytalk.data.repository

import android.util.Log
import com.google.firebase.firestore.FieldValue
import com.google.firebase.firestore.FirebaseFirestore
import com.google.firebase.firestore.Query
import com.google.firebase.firestore.SetOptions
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
import com.shyden.shytalk.data.remote.WorkerApiClient
import kotlinx.coroutines.channels.awaitClose
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.callbackFlow
import kotlinx.coroutines.tasks.await
import org.json.JSONArray
import org.json.JSONObject

private const val TAG = "PMRepository"

class PrivateMessageRepositoryImpl(
    private val api: WorkerApiClient,
    private val firestore: FirebaseFirestore,
    private val authRepository: AuthRepository,
) : PrivateMessageRepository {
    @Volatile private var prefetchedConversations: List<Conversation>? = null

    override suspend fun prefetchConversations() {
        // Firestore offline cache handles this, but we still support the prefetch API
        // for splash screen — just do a Firestore read to warm the cache
        try {
            val uid = authRepository.currentUserId ?: return
            val uidQuery: Any = uid.toLongOrNull() ?: uid
            val snapshot =
                firestore
                    .collection("conversations")
                    .whereArrayContains("participantIds", uidQuery)
                    .orderBy("lastMessageAt", Query.Direction.DESCENDING)
                    .get()
                    .await()
            prefetchedConversations =
                snapshot.documents.mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    Conversation.fromMap(data, doc.id)
                }
        } catch (e: Exception) {
            Log.w(TAG, "Failed to prefetch conversations", e)
        }
    }

    // Real-time conversation list from Firestore
    override fun getConversations(userId: String): Flow<List<Conversation>> =
        callbackFlow {
            prefetchedConversations?.let {
                trySend(it)
                prefetchedConversations = null
            }
            val userIdQuery: Any = userId.toLongOrNull() ?: userId
            val listener =
                firestore
                    .collection("conversations")
                    .whereArrayContains("participantIds", userIdQuery)
                    .orderBy("lastMessageAt", Query.Direction.DESCENDING)
                    .addSnapshotListener { snapshot, error ->
                        if (error != null || snapshot == null) return@addSnapshotListener
                        val conversations =
                            snapshot.documents.mapNotNull { doc ->
                                val data = doc.data ?: return@mapNotNull null
                                Conversation.fromMap(data, doc.id)
                            }
                        trySend(conversations)
                    }
            awaitClose { listener.remove() }
        }

    override suspend fun getOrCreateConversation(
        uid1: String,
        uid2: String,
    ): Resource<Conversation> =
        firebaseCall("Failed to get or create conversation") {
            val conversationId = Conversation.generateId(uid1, uid2)
            val docRef = firestore.document("conversations/$conversationId")
            val doc = docRef.get().await()
            if (doc.exists()) {
                val data = doc.data ?: throw Exception("Conversation data is null")
                Conversation.fromMap(data, conversationId)
            } else {
                val now = System.currentTimeMillis()
                val data =
                    mapOf(
                        "participantIds" to
                            listOf<Any>(
                                uid1.toLongOrNull() ?: uid1,
                                uid2.toLongOrNull() ?: uid2,
                            ).sortedBy { it.toString() },
                        "isGroup" to false,
                        "createdAt" to now,
                        "lastMessageAt" to now,
                        "isClosed" to false,
                    )
                docRef.set(data).await()
                Conversation.fromMap(data, conversationId)
            }
        }

    override suspend fun getConversationSettings(
        conversationId: String,
        userId: String,
    ): Resource<ConversationSettings> =
        firebaseCall("Failed to get conversation settings") {
            val doc = firestore.document("conversations/$conversationId/userSettings/$userId").get().await()
            val data = doc.data ?: return@firebaseCall ConversationSettings.default(userId)
            ConversationSettings.fromMap(data, userId)
        }

    // Real-time conversation settings from Firestore (replaces 120s polling)
    override fun observeConversationSettings(
        conversationId: String,
        userId: String,
    ): Flow<ConversationSettings> =
        callbackFlow {
            val listener =
                firestore
                    .document("conversations/$conversationId/userSettings/$userId")
                    .addSnapshotListener { snapshot, error ->
                        if (error != null || snapshot == null) return@addSnapshotListener
                        val data = snapshot.data
                        val settings =
                            if (data != null) {
                                ConversationSettings.fromMap(data, userId)
                            } else {
                                ConversationSettings.default(userId)
                            }
                        trySend(settings)
                    }
            awaitClose { listener.remove() }
        }

    // Real-time messages from Firestore subcollection
    override fun getMessages(
        conversationId: String,
        limit: Int,
    ): Flow<List<PrivateMessage>> =
        callbackFlow {
            val listener =
                firestore
                    .collection("conversations/$conversationId/messages")
                    .orderBy("createdAt", Query.Direction.ASCENDING)
                    .limitToLast(limit.toLong())
                    .addSnapshotListener { snapshot, error ->
                        if (error != null) {
                            Log.e(TAG, "Messages listener error: ${error.message}", error)
                            trySend(emptyList())
                            return@addSnapshotListener
                        }
                        if (snapshot == null) return@addSnapshotListener
                        val messages =
                            snapshot.documents.mapNotNull { doc ->
                                val data = doc.data ?: return@mapNotNull null
                                PrivateMessage.fromMap(data, doc.id)
                            }
                        trySend(messages)
                    }
            awaitClose { listener.remove() }
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
                    .orderBy("createdAt", Query.Direction.DESCENDING)
                    .whereLessThan("createdAt", beforeTimestamp)
                    .limit(limit.toLong())
                    .get()
                    .await()
            snapshot.documents
                .mapNotNull { doc ->
                    val data = doc.data ?: return@mapNotNull null
                    PrivateMessage.fromMap(data, doc.id)
                }.reversed() // Return in chronological order
        }

    // === Send methods — kept as Worker API (needs FCM push to recipient) ===

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
            val body =
                JSONObject().apply {
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
        replyToSenderName: String?,
    ): Resource<Unit> =
        firebaseCall("Failed to send image message") {
            val body =
                JSONObject().apply {
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

    override suspend fun sendStickerMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        stickerUrl: String,
    ): Resource<Unit> =
        firebaseCall("Failed to send sticker") {
            val body =
                JSONObject().apply {
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
        roomName: String,
    ): Resource<Unit> =
        firebaseCall("Failed to send room invite") {
            val body =
                JSONObject().apply {
                    put("senderId", senderId)
                    put("senderName", senderName)
                    put("text", "")
                    put("type", "ROOM_INVITE")
                    put("roomInviteId", roomId)
                    put("roomInviteName", roomName)
                }
            api.post("/api/conversations/$conversationId/messages", body)
        }

    // === Direct Firestore writes (no FCM push needed) ===

    override suspend fun editMessage(
        conversationId: String,
        messageId: String,
        newText: String,
    ): Resource<Unit> =
        firebaseCall("Failed to edit message") {
            val messageRef = firestore.document("conversations/$conversationId/messages/$messageId")
            // Read current message to save edit history
            val currentDoc = messageRef.get().await()
            val currentText = currentDoc.getString("text") ?: ""
            val now = System.currentTimeMillis()
            // Atomic batch: save edit history + update message together
            val editRef = messageRef.collection("edits").document()
            val batch = firestore.batch()
            batch.set(
                editRef,
                mapOf(
                    "previousText" to currentText,
                    "editedAt" to now,
                ),
            )
            batch.update(
                messageRef,
                mapOf(
                    "text" to newText,
                    "isEdited" to true,
                    "editedAt" to now,
                    "editCount" to FieldValue.increment(1),
                ),
            )
            batch.commit().await()
        }

    override suspend fun getEditHistory(
        conversationId: String,
        messageId: String,
    ): Resource<List<MessageEdit>> =
        firebaseCall("Failed to get edit history") {
            val snapshot =
                firestore
                    .collection("conversations/$conversationId/messages/$messageId/edits")
                    .orderBy("editedAt", Query.Direction.ASCENDING)
                    .get()
                    .await()
            snapshot.documents.mapNotNull { doc ->
                val data = doc.data ?: return@mapNotNull null
                MessageEdit.fromMap(data, doc.id)
            }
        }

    override suspend fun markAsRead(
        conversationId: String,
        userId: String,
        messageId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to mark as read") {
            firestore
                .document("conversations/$conversationId/userSettings/$userId")
                .set(
                    mapOf(
                        "lastReadMessageId" to messageId,
                        "unreadCount" to 0,
                        "lastReadAt" to System.currentTimeMillis(),
                    ),
                    SetOptions.merge(),
                ).await()
        }

    override suspend fun resetUnreadCount(
        conversationId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to reset unread count") {
            firestore
                .document("conversations/$conversationId/userSettings/$userId")
                .set(mapOf("unreadCount" to 0), SetOptions.merge())
                .await()
        }

    override suspend fun muteConversation(
        conversationId: String,
        userId: String,
        muted: Boolean,
    ): Resource<Unit> =
        firebaseCall("Failed to mute conversation") {
            firestore
                .document("conversations/$conversationId/userSettings/$userId")
                .set(mapOf("isMuted" to muted), SetOptions.merge())
                .await()
        }

    override suspend fun pinConversation(
        conversationId: String,
        userId: String,
        pinned: Boolean,
    ): Resource<Unit> =
        firebaseCall("Failed to pin conversation") {
            firestore
                .document("conversations/$conversationId/userSettings/$userId")
                .set(mapOf("isPinned" to pinned), SetOptions.merge())
                .await()
        }

    override suspend fun hideConversation(
        conversationId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to hide conversation") {
            firestore
                .document("conversations/$conversationId/userSettings/$userId")
                .set(
                    mapOf(
                        "isHidden" to true,
                        "hiddenAt" to System.currentTimeMillis(),
                    ),
                    SetOptions.merge(),
                ).await()
        }

    override suspend fun toggleReaction(
        conversationId: String,
        messageId: String,
        emoji: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to toggle reaction") {
            val messageRef = firestore.document("conversations/$conversationId/messages/$messageId")
            firestore
                .runTransaction { transaction ->
                    val doc = transaction.get(messageRef)
                    val data = doc.data ?: throw Exception("Message not found")

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
                    transaction.update(messageRef, "reactions", reactions)
                }.await()
        }

    override suspend fun searchMessages(
        conversationId: String,
        query: String,
    ): Resource<List<PrivateMessage>> =
        firebaseCall("Failed to search messages") {
            val snapshot =
                firestore
                    .collection("conversations/$conversationId/messages")
                    .orderBy("createdAt", Query.Direction.DESCENDING)
                    .limit(500)
                    .get()
                    .await()
            val lowerQuery = query.lowercase()
            snapshot.documents.mapNotNull { doc ->
                val data = doc.data ?: return@mapNotNull null
                val message = PrivateMessage.fromMap(data, doc.id)
                if (message.text.lowercase().contains(lowerQuery)) message else null
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
            val docRef = firestore.collection("conversations").document()
            val now = System.currentTimeMillis()
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
            docRef.set(data).await()
            // Create userSettings docs for all participants with unreadCount: 0
            val batch = firestore.batch()
            for (pid in participantIds) {
                val settingsRef = docRef.collection("userSettings").document(pid)
                batch.set(settingsRef, mapOf("unreadCount" to 0, "userId" to pid))
            }
            batch.commit().await()
            Conversation.fromMap(data, docRef.id)
        }

    override suspend fun addGroupParticipant(
        conversationId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to add participant") {
            firestore
                .document("conversations/$conversationId")
                .update("participantIds", FieldValue.arrayUnion(userId))
                .await()
        }

    override suspend fun removeGroupParticipant(
        conversationId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to remove participant") {
            firestore
                .document("conversations/$conversationId")
                .update("participantIds", FieldValue.arrayRemove(userId))
                .await()
        }

    override suspend fun updateGroupName(
        conversationId: String,
        newName: String,
    ): Resource<Unit> =
        firebaseCall("Failed to update group name") {
            firestore
                .document("conversations/$conversationId")
                .update("groupName", newName)
                .await()
        }

    override suspend fun getModerationConfig(): Resource<List<String>> =
        firebaseCall("Failed to load moderation config") {
            val doc = firestore.document("config/moderation").get().await()
            val data = doc.data ?: return@firebaseCall emptyList()
            (data["prohibitedWords"] as? List<*>)?.filterIsInstance<String>() ?: emptyList()
        }

    // Single conversation read from Firestore
    override suspend fun getConversation(conversationId: String): Resource<Conversation> =
        firebaseCall("Failed to get conversation") {
            val doc = firestore.document("conversations/$conversationId").get().await()
            val data = doc.data ?: throw Exception("Conversation not found")
            Conversation.fromMap(data, conversationId)
        }

    override suspend fun closeGroupConversation(conversationId: String): Resource<Unit> =
        firebaseCall("Failed to close group conversation") {
            firestore
                .document("conversations/$conversationId")
                .update("isClosed", true)
                .await()
        }

    override suspend fun recallMessage(
        conversationId: String,
        messageId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to recall message") {
            firestore
                .document("conversations/$conversationId/messages/$messageId")
                .update(mapOf("isRecalled" to true, "text" to ""))
                .await()
        }

    // ===== Mod Actions =====

    override suspend fun muteGroupMember(
        conversationId: String,
        userId: String,
        duration: Long?,
        reason: String?,
    ): Resource<Unit> =
        firebaseCall("Failed to mute member") {
            val now = System.currentTimeMillis()
            val data =
                mutableMapOf<String, Any?>(
                    "userId" to userId,
                    "mutedAt" to now,
                )
            duration?.let { data["duration"] = it }
            reason?.let { data["reason"] = it }
            firestore
                .document("conversations/$conversationId/mutes/$userId")
                .set(data)
                .await()
        }

    override suspend fun unmuteGroupMember(
        conversationId: String,
        userId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to unmute member") {
            firestore
                .document("conversations/$conversationId/mutes/$userId")
                .delete()
                .await()
        }

    override suspend fun getGroupMutes(conversationId: String): Resource<List<MuteInfo>> =
        firebaseCall("Failed to get mutes") {
            val snapshot =
                firestore
                    .collection("conversations/$conversationId/mutes")
                    .get()
                    .await()
            snapshot.documents.mapNotNull { doc ->
                val data = doc.data ?: return@mapNotNull null
                MuteInfo.fromMap(data, doc.id)
            }
        }

    override suspend fun hideMessage(
        conversationId: String,
        messageId: String,
        hiddenBy: String,
    ): Resource<Unit> =
        firebaseCall("Failed to hide message") {
            firestore
                .document("conversations/$conversationId/messages/$messageId")
                .update(mapOf("isHidden" to true, "hiddenBy" to hiddenBy))
                .await()
        }

    // ===== Role Management =====

    override suspend fun updateGroupRoles(
        conversationId: String,
        adminIds: List<String>,
        modIds: List<String>,
    ): Resource<Unit> =
        firebaseCall("Failed to update roles") {
            firestore
                .document("conversations/$conversationId")
                .update(mapOf("groupAdminIds" to adminIds, "groupModIds" to modIds))
                .await()
        }

    override suspend fun transferOwnership(
        conversationId: String,
        newOwnerId: String,
    ): Resource<Unit> =
        firebaseCall("Failed to transfer ownership") {
            firestore
                .document("conversations/$conversationId")
                .update("createdBy", newOwnerId)
                .await()
        }

    // ===== Permissions =====

    override suspend fun updateGroupPermissions(
        conversationId: String,
        permissions: GroupPermissions,
    ): Resource<Unit> =
        firebaseCall("Failed to update permissions") {
            firestore
                .document("conversations/$conversationId")
                .update("permissions", permissions.toMap())
                .await()
        }

    override suspend fun updateSystemMessageConfig(
        conversationId: String,
        config: SystemMessageConfig,
    ): Resource<Unit> =
        firebaseCall("Failed to update system message config") {
            firestore
                .document("conversations/$conversationId")
                .update("systemMessageConfig", config.toMap())
                .await()
        }

    override suspend fun updateModNotifyMode(
        conversationId: String,
        mode: String,
    ): Resource<Unit> =
        firebaseCall("Failed to update mod notify mode") {
            firestore
                .document("conversations/$conversationId")
                .update("modNotifyMode", mode)
                .await()
        }

    // ===== Group Info =====

    override suspend fun updateGroupDescription(
        conversationId: String,
        description: String,
    ): Resource<Unit> =
        firebaseCall("Failed to update description") {
            firestore
                .document("conversations/$conversationId")
                .update("groupDescription", description)
                .await()
        }

    override suspend fun updateGroupPhoto(
        conversationId: String,
        photoUrl: String?,
    ): Resource<Unit> =
        firebaseCall("Failed to update group photo") {
            firestore
                .document("conversations/$conversationId")
                .update("groupPhotoUrl", photoUrl)
                .await()
        }

    // ===== Search =====

    override suspend fun searchUsers(
        query: String,
        currentUserId: String,
    ): Resource<List<User>> =
        firebaseCall("Failed to search users") {
            val snapshot =
                firestore
                    .collection("users")
                    .whereGreaterThanOrEqualTo("displayName", query)
                    .whereLessThan("displayName", query + "\uf8ff")
                    .get()
                    .await()
            snapshot.documents.mapNotNull { doc ->
                val data = doc.data ?: return@mapNotNull null
                if (doc.id == currentUserId) return@mapNotNull null
                User.fromMap(data, doc.id)
            }
        }

    // ===== Counting =====

    override suspend fun getOwnedGroupCount(userId: String): Resource<Int> =
        firebaseCall("Failed to get owned group count") {
            val snapshot =
                firestore
                    .collection("conversations")
                    .whereEqualTo("createdBy", userId)
                    .whereEqualTo("isGroup", true)
                    .get()
                    .await()
            snapshot.documents.count { doc ->
                val data = doc.data ?: return@count false
                (data["isClosed"] as? Boolean) != true
            }
        }
}
