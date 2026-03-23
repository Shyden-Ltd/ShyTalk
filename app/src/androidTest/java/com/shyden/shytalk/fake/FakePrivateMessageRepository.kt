package com.shyden.shytalk.fake

import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.model.ConversationSettings
import com.shyden.shytalk.core.model.GroupPermissions
import com.shyden.shytalk.core.model.MessageEdit
import com.shyden.shytalk.core.model.MuteInfo
import com.shyden.shytalk.core.model.PrivateMessage
import com.shyden.shytalk.core.model.PrivateMessageType
import com.shyden.shytalk.core.model.SystemMessageConfig
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.testdata.TestData
import kotlinx.coroutines.flow.Flow
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.flowOf

class FakePrivateMessageRepository : PrivateMessageRepository {
    val conversations = MutableStateFlow(TestData.sampleConversations)
    val messagesMap = mutableMapOf<String, MutableStateFlow<List<PrivateMessage>>>()

    override fun getConversations(userId: String): Flow<List<Conversation>> = conversations

    override suspend fun getOrCreateConversation(
        uid1: String,
        uid2: String,
    ): Resource<Conversation> {
        val existing =
            conversations.value.find {
                it.participantIds.containsAll(listOf(uid1, uid2)) && !it.isGroup
            }
        if (existing != null) return Resource.Success(existing)
        val newConv =
            Conversation(
                conversationId = "conv-new",
                participantIds = listOf(uid1, uid2),
            )
        conversations.value = conversations.value + newConv
        return Resource.Success(newConv)
    }

    override suspend fun getConversationSettings(
        conversationId: String,
        userId: String,
    ): Resource<ConversationSettings> = Resource.Success(ConversationSettings(userId = userId))

    override fun observeConversationSettings(
        conversationId: String,
        userId: String,
    ): Flow<ConversationSettings> = flowOf(ConversationSettings(userId = userId))

    override fun getMessages(
        conversationId: String,
        limit: Int,
    ): Flow<List<PrivateMessage>> = messagesMap.getOrPut(conversationId) { MutableStateFlow(emptyList()) }

    override suspend fun loadOlderMessages(
        conversationId: String,
        beforeTimestamp: Long,
        limit: Int,
    ): Resource<List<PrivateMessage>> = Resource.Success(emptyList())

    override suspend fun sendTextMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        text: String,
        replyToMessageId: String?,
        replyToText: String?,
        replyToSenderName: String?,
    ): Resource<Unit> {
        val flow = messagesMap.getOrPut(conversationId) { MutableStateFlow(emptyList()) }
        val msg =
            PrivateMessage(
                messageId = "pm-${System.currentTimeMillis()}",
                senderId = senderId,
                senderName = senderName,
                text = text,
                type = PrivateMessageType.TEXT,
            )
        flow.value = flow.value + msg
        return Resource.Success(Unit)
    }

    override suspend fun sendImageMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        imageUrls: List<String>,
        replyToMessageId: String?,
        replyToText: String?,
        replyToSenderName: String?,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun editMessage(
        conversationId: String,
        messageId: String,
        newText: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun getEditHistory(
        conversationId: String,
        messageId: String,
    ): Resource<List<MessageEdit>> = Resource.Success(emptyList())

    override suspend fun markAsRead(
        conversationId: String,
        userId: String,
        messageId: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun resetUnreadCount(
        conversationId: String,
        userId: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun muteConversation(
        conversationId: String,
        userId: String,
        muted: Boolean,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun pinConversation(
        conversationId: String,
        userId: String,
        pinned: Boolean,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun hideConversation(
        conversationId: String,
        userId: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun toggleReaction(
        conversationId: String,
        messageId: String,
        emoji: String,
        userId: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun searchMessages(
        conversationId: String,
        query: String,
    ): Resource<List<PrivateMessage>> = Resource.Success(emptyList())

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
    ): Resource<Conversation> {
        val conv =
            Conversation(
                conversationId = "group-new",
                participantIds = participantIds,
                isGroup = true,
                groupName = groupName,
                createdBy = creatorId,
            )
        conversations.value = conversations.value + conv
        return Resource.Success(conv)
    }

    override suspend fun addGroupParticipant(
        conversationId: String,
        userId: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun removeGroupParticipant(
        conversationId: String,
        userId: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun updateGroupName(
        conversationId: String,
        newName: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun sendStickerMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        stickerUrl: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun sendRoomInviteMessage(
        conversationId: String,
        senderId: String,
        senderName: String,
        roomId: String,
        roomName: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun getModerationConfig(): Resource<List<String>> = Resource.Success(emptyList())

    override suspend fun getConversation(conversationId: String): Resource<Conversation> {
        val conv =
            conversations.value.find { it.conversationId == conversationId }
                ?: return Resource.Error("Conversation not found")
        return Resource.Success(conv)
    }

    override suspend fun closeGroupConversation(conversationId: String): Resource<Unit> = Resource.Success(Unit)

    override suspend fun recallMessage(
        conversationId: String,
        messageId: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun muteGroupMember(
        conversationId: String,
        userId: String,
        duration: Long?,
        reason: String?,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun unmuteGroupMember(
        conversationId: String,
        userId: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun getGroupMutes(conversationId: String): Resource<List<MuteInfo>> = Resource.Success(emptyList())

    override suspend fun hideMessage(
        conversationId: String,
        messageId: String,
        hiddenBy: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun updateGroupRoles(
        conversationId: String,
        adminIds: List<String>,
        modIds: List<String>,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun transferOwnership(
        conversationId: String,
        newOwnerId: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun updateGroupPermissions(
        conversationId: String,
        permissions: GroupPermissions,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun updateSystemMessageConfig(
        conversationId: String,
        config: SystemMessageConfig,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun updateModNotifyMode(
        conversationId: String,
        mode: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun updateGroupDescription(
        conversationId: String,
        description: String,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun updateGroupPhoto(
        conversationId: String,
        photoUrl: String?,
    ): Resource<Unit> = Resource.Success(Unit)

    override suspend fun searchUsers(
        query: String,
        currentUserId: String,
    ): Resource<List<User>> = Resource.Success(emptyList())

    override suspend fun getOwnedGroupCount(userId: String): Resource<Int> = Resource.Success(0)
}
