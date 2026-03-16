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
import kotlinx.coroutines.flow.Flow

interface PrivateMessageRepository {
    fun getConversations(userId: String): Flow<List<Conversation>>

    suspend fun getOrCreateConversation(
        uid1: String,
        uid2: String,
    ): Resource<Conversation>

    suspend fun getConversationSettings(
        conversationId: String,
        userId: String,
    ): Resource<ConversationSettings>

    fun observeConversationSettings(
        conversationId: String,
        userId: String,
    ): Flow<ConversationSettings>

    fun getMessages(
        conversationId: String,
        limit: Int,
    ): Flow<List<PrivateMessage>>

    suspend fun loadOlderMessages(
        conversationId: String,
        beforeTimestamp: Long,
        limit: Int,
    ): Resource<List<PrivateMessage>>

    suspend fun sendTextMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        text: String,
        replyToMessageId: String? = null,
        replyToText: String? = null,
        replyToSenderName: String? = null,
    ): Resource<Unit>

    suspend fun sendImageMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        imageUrls: List<String>,
        replyToMessageId: String? = null,
        replyToText: String? = null,
        replyToSenderName: String? = null,
    ): Resource<Unit>

    suspend fun editMessage(
        conversationId: String,
        messageId: String,
        newText: String,
    ): Resource<Unit>

    suspend fun getEditHistory(
        conversationId: String,
        messageId: String,
    ): Resource<List<MessageEdit>>

    suspend fun markAsRead(
        conversationId: String,
        userId: String,
        messageId: String,
    ): Resource<Unit>

    suspend fun resetUnreadCount(
        conversationId: String,
        userId: String,
    ): Resource<Unit>

    suspend fun muteConversation(
        conversationId: String,
        userId: String,
        muted: Boolean,
    ): Resource<Unit>

    suspend fun pinConversation(
        conversationId: String,
        userId: String,
        pinned: Boolean,
    ): Resource<Unit>

    suspend fun hideConversation(
        conversationId: String,
        userId: String,
    ): Resource<Unit>

    suspend fun toggleReaction(
        conversationId: String,
        messageId: String,
        emoji: String,
        userId: String,
    ): Resource<Unit>

    suspend fun searchMessages(
        conversationId: String,
        query: String,
    ): Resource<List<PrivateMessage>>

    suspend fun createGroupConversation(
        creatorId: String,
        participantIds: List<String>,
        groupName: String,
        groupDescription: String? = null,
        groupPhotoUrl: String? = null,
        adminIds: List<String> = emptyList(),
        modIds: List<String> = emptyList(),
        permissions: GroupPermissions = GroupPermissions(),
        systemMessageConfig: SystemMessageConfig = SystemMessageConfig(),
    ): Resource<Conversation>

    suspend fun addGroupParticipant(
        conversationId: String,
        userId: String,
    ): Resource<Unit>

    suspend fun removeGroupParticipant(
        conversationId: String,
        userId: String,
    ): Resource<Unit>

    suspend fun updateGroupName(
        conversationId: String,
        newName: String,
    ): Resource<Unit>

    suspend fun sendStickerMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        stickerUrl: String,
    ): Resource<Unit>

    suspend fun sendRoomInviteMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        roomId: String,
        roomName: String,
    ): Resource<Unit>

    suspend fun getModerationConfig(): Resource<List<String>>

    suspend fun getConversation(conversationId: String): Resource<Conversation>

    suspend fun closeGroupConversation(conversationId: String): Resource<Unit>

    suspend fun recallMessage(
        conversationId: String,
        messageId: String,
    ): Resource<Unit>

    // Mod actions
    suspend fun muteGroupMember(
        conversationId: String,
        userId: String,
        duration: Long?,
        reason: String?,
    ): Resource<Unit>

    suspend fun unmuteGroupMember(
        conversationId: String,
        userId: String,
    ): Resource<Unit>

    suspend fun getGroupMutes(conversationId: String): Resource<List<MuteInfo>>

    suspend fun hideMessage(
        conversationId: String,
        messageId: String,
        hiddenBy: String,
    ): Resource<Unit>

    // Role management
    suspend fun updateGroupRoles(
        conversationId: String,
        adminIds: List<String>,
        modIds: List<String>,
    ): Resource<Unit>

    suspend fun transferOwnership(
        conversationId: String,
        newOwnerId: String,
    ): Resource<Unit>

    // Permissions
    suspend fun updateGroupPermissions(
        conversationId: String,
        permissions: GroupPermissions,
    ): Resource<Unit>

    suspend fun updateSystemMessageConfig(
        conversationId: String,
        config: SystemMessageConfig,
    ): Resource<Unit>

    suspend fun updateModNotifyMode(
        conversationId: String,
        mode: String,
    ): Resource<Unit>

    // Group info
    suspend fun updateGroupDescription(
        conversationId: String,
        description: String,
    ): Resource<Unit>

    suspend fun updateGroupPhoto(
        conversationId: String,
        photoUrl: String?,
    ): Resource<Unit>

    // Search
    suspend fun searchUsers(
        query: String,
        currentUserId: String,
    ): Resource<List<User>>

    // Counting
    suspend fun getOwnedGroupCount(userId: String): Resource<Int>

    suspend fun prefetchConversations() {}
}
