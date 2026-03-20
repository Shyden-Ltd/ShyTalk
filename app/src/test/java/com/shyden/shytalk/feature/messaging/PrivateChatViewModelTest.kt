package com.shyden.shytalk.feature.messaging

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.Conversation
import com.shyden.shytalk.core.model.ConversationSettings
import com.shyden.shytalk.core.model.GroupPermissions
import com.shyden.shytalk.core.model.MessageEdit
import com.shyden.shytalk.core.model.PmPrivacy
import com.shyden.shytalk.core.model.PrivateMessage
import com.shyden.shytalk.core.model.PrivateMessageType
import com.shyden.shytalk.core.model.SystemMessageConfig
import com.shyden.shytalk.core.util.Constants
import com.shyden.shytalk.core.util.ModerationFilter
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.local.StickerStorage
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.ReportRepository
import com.shyden.shytalk.data.repository.StorageRepository
import com.shyden.shytalk.data.repository.TypingRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import io.mockk.verify
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancel
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.After
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class PrivateChatViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val pmRepository = mockk<PrivateMessageRepository>(relaxed = true)
    private val typingRepository = mockk<TypingRepository>(relaxed = true)
    private val reportRepository = mockk<ReportRepository>(relaxed = true)
    private val storageRepository = mockk<StorageRepository>(relaxed = true)
    private val stickerStorage = mockk<StickerStorage>(relaxed = true)

    private val currentUserId = "current-user"
    private val otherUserId = "other-user"
    private val conversationId = "current-user_other-user"

    private lateinit var messagesFlow: MutableSharedFlow<List<PrivateMessage>>
    private lateinit var settingsFlow: MutableSharedFlow<ConversationSettings>
    private val activeViewModels = mutableListOf<PrivateChatViewModel>()
    private lateinit var typingFlow: MutableSharedFlow<Boolean>

    @After
    fun tearDown() = runBlocking {
        activeViewModels.forEach { vm ->
            vm.viewModelScope.coroutineContext.job.cancelAndJoin()
        }
        activeViewModels.clear()
        // Allow coroutine cleanup to complete, preventing UncaughtExceptionsBeforeTest
        kotlinx.coroutines.delay(50)
    }

    @Before
    fun setup() {
        messagesFlow = MutableSharedFlow()
        settingsFlow = MutableSharedFlow()
        typingFlow = MutableSharedFlow()

        ModerationFilter.reset()
        ModerationFilter.updateProhibitedWords(emptyList())

        every { authRepository.currentUserId } returns currentUserId

        val currentUser = TestData.createTestUser(uid = currentUserId, displayName = "Current")
        val otherUser = TestData.createTestUser(uid = otherUserId, displayName = "Other")

        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(currentUser)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(otherUser)
        coEvery { userRepository.getAliases(any()) } returns Resource.Success(emptyMap())

        val conversation = TestData.createTestConversation(
            conversationId = conversationId,
            participantIds = listOf(currentUserId, otherUserId)
        )
        coEvery { pmRepository.getOrCreateConversation(currentUserId, otherUserId) } returns
                Resource.Success(conversation)

        every { pmRepository.getMessages(conversationId, any()) } returns messagesFlow
        every { pmRepository.observeConversationSettings(conversationId, currentUserId) } returns settingsFlow
        every { typingRepository.observeTyping(conversationId, otherUserId) } returns typingFlow
    }

    private fun createViewModel(): PrivateChatViewModel {
        return PrivateChatViewModel(
            otherUserId = otherUserId,
            pmRepository = pmRepository,
            userRepository = userRepository,
            authRepository = authRepository,
            typingRepository = typingRepository,
            reportRepository = reportRepository,
            storageRepository = storageRepository
        ).also { activeViewModels.add(it) }
    }

    // ===== Init =====

    @Test
    fun `init loads users and conversationId`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(conversationId, state.conversationId)
        assertEquals(currentUserId, state.currentUserId)
        assertEquals("Current", state.currentUserName)
        assertNotNull(state.otherUser)
        assertNotNull(state.currentUser)
        assertFalse(state.isLoading)
    }

    @Test
    fun `init handles getOrCreateConversation failure`() = runTest {
        coEvery { pmRepository.getOrCreateConversation(currentUserId, otherUserId) } returns
                Resource.Error("network error")

        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals("network error", vm.uiState.value.error)
        assertEquals("", vm.uiState.value.conversationId)
    }

    @Test
    fun `init skips when no currentUserId`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = PrivateChatViewModel(
            otherUserId = otherUserId,
            pmRepository = pmRepository,
            userRepository = userRepository,
            authRepository = mockk { every { currentUserId } returns null },
            typingRepository = typingRepository,
            reportRepository = reportRepository
        ).also { activeViewModels.add(it) }
        advanceUntilIdle()

        // Should not have loaded anything
        assertNull(vm.uiState.value.currentUser)
        assertNull(vm.uiState.value.otherUser)
    }

    // ===== Restrictions =====

    @Test
    fun `blocked by other user sets isBlocked`() = runTest {
        val otherUser = TestData.createTestUser(
            uid = otherUserId,
            blockedUserIds = setOf(currentUserId)
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(otherUser)

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isBlocked)
        assertTrue(vm.uiState.value.blockReason!!.contains("blocked by this user"))
    }

    @Test
    fun `blocked by self sets isBlocked`() = runTest {
        val currentUser = TestData.createTestUser(
            uid = currentUserId,
            blockedUserIds = setOf(otherUserId)
        )
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(currentUser)

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isBlocked)
        assertTrue(vm.uiState.value.blockReason!!.contains("blocked this user"))
    }

    @Test
    fun `pmPrivacy NO_ONE blocks messaging`() = runTest {
        val otherUser = TestData.createTestUser(uid = otherUserId).copy(pmPrivacy = PmPrivacy.NO_ONE)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(otherUser)

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isBlocked)
        assertTrue(vm.uiState.value.blockReason!!.contains("does not accept"))
    }

    @Test
    fun `pmPrivacy FOLLOWERS_ONLY blocks when not followed`() = runTest {
        val otherUser = TestData.createTestUser(uid = otherUserId).copy(
            pmPrivacy = PmPrivacy.FOLLOWERS_ONLY,
            followingIds = emptySet()
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(otherUser)

        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isBlocked)
        assertTrue(vm.uiState.value.blockReason!!.contains("people they follow"))
    }

    @Test
    fun `pmPrivacy FOLLOWERS_ONLY allows when followed`() = runTest {
        val otherUser = TestData.createTestUser(uid = otherUserId).copy(
            pmPrivacy = PmPrivacy.FOLLOWERS_ONLY,
            followingIds = setOf(currentUserId)
        )
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(otherUser)

        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isBlocked)
    }

    @Test
    fun `pmPrivacy EVERYONE does not block`() = runTest {
        val otherUser = TestData.createTestUser(uid = otherUserId).copy(pmPrivacy = PmPrivacy.EVERYONE)
        coEvery { userRepository.getUser(otherUserId) } returns Resource.Success(otherUser)

        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isBlocked)
    }

    // ===== Send Message =====

    @Test
    fun `sendMessage calls repo with correct params`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Success(Unit)

        vm.sendMessage("Hello!")
        advanceUntilIdle()

        coVerify {
            pmRepository.sendTextMessage(
                conversationId = conversationId,
                senderId = currentUserId,
                senderName = "Current",
                text = "Hello!",
                replyToMessageId = null,
                replyToText = null,
                replyToSenderName = null
            )
        }
    }

    @Test
    fun `sendMessage trims whitespace`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Success(Unit)

        vm.sendMessage("  Hello!  ")
        advanceUntilIdle()

        coVerify {
            pmRepository.sendTextMessage(
                conversationId = any(),
                senderId = any(),
                senderName = any(),
                text = "Hello!",
                replyToMessageId = any(),
                replyToText = any(),
                replyToSenderName = any()
            )
        }
    }

    @Test
    fun `sendMessage rejects empty text`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.sendMessage("")
        vm.sendMessage("   ")
        advanceUntilIdle()

        coVerify(exactly = 0) { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `sendMessage rejects overlength text`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val longText = "A".repeat(Constants.MAX_PM_MESSAGE_LENGTH + 1)
        vm.sendMessage(longText)
        advanceUntilIdle()

        coVerify(exactly = 0) { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `sendMessage moderation filter blocks`() = runTest {
        ModerationFilter.updateProhibitedWords(listOf("badword"))

        val vm = createViewModel()
        advanceUntilIdle()

        vm.sendMessage("This has badword in it")
        advanceUntilIdle()

        assertNotNull(vm.uiState.value.error)
        assertTrue(vm.uiState.value.error!!.contains("inappropriate"))
        coVerify(exactly = 0) { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `sendMessage spam filter blocks`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Success(Unit)

        vm.sendMessage("spam")
        vm.sendMessage("spam")
        vm.sendMessage("spam") // 3rd identical
        advanceUntilIdle()

        assertEquals("Please wait before sending the same message again.", vm.uiState.value.error)
    }

    @Test
    fun `sendMessage clears reply`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val replyMsg = TestData.createTestPrivateMessage(messageId = "reply-1", text = "Reply text", senderName = "Bob")
        vm.startReply(replyMsg)
        assertNotNull(vm.uiState.value.replyingToMessage)

        coEvery { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Success(Unit)
        vm.sendMessage("With reply")
        advanceUntilIdle()

        assertNull(vm.uiState.value.replyingToMessage)
    }

    @Test
    fun `sendMessage repo failure sets error`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Error("send failed")

        vm.sendMessage("Hello!")
        advanceUntilIdle()

        assertEquals("Failed to send message", vm.uiState.value.error)
    }

    // ===== Send Images =====

    @Test
    fun `sendImages calls repo with correct params`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.sendImageMessage(any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Success(Unit)

        vm.sendImages(listOf("https://img1.png", "https://img2.png"))
        advanceUntilIdle()

        coVerify {
            pmRepository.sendImageMessage(
                conversationId = conversationId,
                senderId = currentUserId,
                senderName = "Current",
                imageUrls = listOf("https://img1.png", "https://img2.png"),
                replyToMessageId = null,
                replyToText = null,
                replyToSenderName = null
            )
        }
    }

    @Test
    fun `sendImages rejects empty list`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.sendImages(emptyList())
        advanceUntilIdle()

        coVerify(exactly = 0) { pmRepository.sendImageMessage(any(), any(), any(), any(), any(), any(), any()) }
    }

    @Test
    fun `sendImages clears reply`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val replyMsg = TestData.createTestPrivateMessage(messageId = "reply-1")
        vm.startReply(replyMsg)
        assertNotNull(vm.uiState.value.replyingToMessage)

        coEvery { pmRepository.sendImageMessage(any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Success(Unit)
        vm.sendImages(listOf("https://img.png"))
        advanceUntilIdle()

        assertNull(vm.uiState.value.replyingToMessage)
    }

    // ===== Edit =====

    @Test
    fun `startEditing sets editing state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msg = TestData.createTestPrivateMessage(
            messageId = "msg-1",
            senderId = currentUserId,
            text = "Original",
            createdAt = System.currentTimeMillis() // within edit window
        )
        vm.startEditing(msg)

        assertEquals("msg-1", vm.uiState.value.editingMessageId)
        assertEquals("Original", vm.uiState.value.editingOriginalText)
    }

    @Test
    fun `startEditing rejects other users message`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msg = TestData.createTestPrivateMessage(
            senderId = otherUserId,
            createdAt = System.currentTimeMillis()
        )
        vm.startEditing(msg)

        assertNull(vm.uiState.value.editingMessageId)
    }

    @Test
    fun `startEditing rejects expired window`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msg = TestData.createTestPrivateMessage(
            senderId = currentUserId,
            createdAt = System.currentTimeMillis() - Constants.PM_EDIT_WINDOW_MS - 1000
        )
        vm.startEditing(msg)

        assertNull(vm.uiState.value.editingMessageId)
    }

    @Test
    fun `cancelEditing clears editing state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msg = TestData.createTestPrivateMessage(
            senderId = currentUserId,
            createdAt = System.currentTimeMillis()
        )
        vm.startEditing(msg)
        assertNotNull(vm.uiState.value.editingMessageId)

        vm.cancelEditing()
        assertNull(vm.uiState.value.editingMessageId)
        assertEquals("", vm.uiState.value.editingOriginalText)
    }

    @Test
    fun `submitEdit calls repo`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msg = TestData.createTestPrivateMessage(
            messageId = "msg-edit",
            senderId = currentUserId,
            createdAt = System.currentTimeMillis()
        )
        vm.startEditing(msg)

        coEvery { pmRepository.editMessage(any(), any(), any()) } returns Resource.Success(Unit)
        vm.submitEdit("New text")
        advanceUntilIdle()

        coVerify { pmRepository.editMessage(conversationId, "msg-edit", "New text") }
        assertNull(vm.uiState.value.editingMessageId)
    }

    // ===== Reply =====

    @Test
    fun `startReply sets state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msg = TestData.createTestPrivateMessage(messageId = "r-1", text = "Reply target")
        vm.startReply(msg)

        assertEquals(msg, vm.uiState.value.replyingToMessage)
    }

    @Test
    fun `cancelReply clears state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.startReply(TestData.createTestPrivateMessage())
        assertNotNull(vm.uiState.value.replyingToMessage)

        vm.cancelReply()
        assertNull(vm.uiState.value.replyingToMessage)
    }

    // ===== Toggles =====

    @Test
    fun `toggleMute calls repo with inverted value`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        // Default isMuted is false, so toggle should pass true
        coEvery { pmRepository.muteConversation(any(), any(), any()) } returns Resource.Success(Unit)
        vm.toggleMute()
        advanceUntilIdle()

        coVerify { pmRepository.muteConversation(conversationId, currentUserId, true) }
    }

    @Test
    fun `togglePin calls repo with inverted value`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.pinConversation(any(), any(), any()) } returns Resource.Success(Unit)
        vm.togglePin()
        advanceUntilIdle()

        coVerify { pmRepository.pinConversation(conversationId, currentUserId, true) }
    }

    @Test
    fun `hideConversation calls repo`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.hideConversation(any(), any()) } returns Resource.Success(Unit)
        vm.hideConversation()
        advanceUntilIdle()

        coVerify { pmRepository.hideConversation(conversationId, currentUserId) }
    }

    // ===== Search =====

    @Test
    fun `toggleSearch enables and disables`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.toggleSearch()
        assertTrue(vm.uiState.value.isSearching)

        vm.toggleSearch()
        assertFalse(vm.uiState.value.isSearching)
        assertEquals("", vm.uiState.value.searchQuery)
        assertEquals(emptyList<PrivateMessage>(), vm.uiState.value.searchResults)
    }

    @Test
    fun `searchMessages short query clears results`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.searchMessages("a") // too short (< 2)
        advanceUntilIdle()

        assertEquals(emptyList<PrivateMessage>(), vm.uiState.value.searchResults)
    }

    @Test
    fun `searchMessages updates results`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val results = listOf(TestData.createTestPrivateMessage(text = "Hello world"))
        coEvery { pmRepository.searchMessages(conversationId, "Hello") } returns Resource.Success(results)

        vm.searchMessages("Hello")
        advanceUntilIdle()

        assertEquals(results, vm.uiState.value.searchResults)
        assertEquals("Hello", vm.uiState.value.searchQuery)
    }

    // ===== Typing =====

    @Test
    fun `onTextChanged sets typing`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.onTextChanged()

        verify { typingRepository.setTyping(conversationId, currentUserId, true) }
    }

    @Test
    fun `observeTyping updates state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isOtherUserTyping)

        typingFlow.emit(true)
        advanceUntilIdle()
        assertTrue(vm.uiState.value.isOtherUserTyping)

        typingFlow.emit(false)
        advanceUntilIdle()
        assertFalse(vm.uiState.value.isOtherUserTyping)
    }

    // ===== Reaction =====

    @Test
    fun `toggleReaction calls repo with correct params`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.toggleReaction(any(), any(), any(), any()) } returns Resource.Success(Unit)
        vm.toggleReaction("msg-1", "👍")
        advanceUntilIdle()

        coVerify { pmRepository.toggleReaction(conversationId, "msg-1", "👍", currentUserId) }
    }

    // ===== Report =====

    @Test
    fun `reportMessage calls reportRepo on success`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { reportRepository.reportMessage(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Success(Unit)

        val msg = TestData.createTestPrivateMessage(messageId = "msg-r", senderId = otherUserId, text = "Bad msg")
        vm.reportMessage(msg, "spam", "It's spam")
        advanceUntilIdle()

        coVerify {
            reportRepository.reportMessage(
                reporterId = currentUserId,
                reporterName = any(),
                reporterUniqueId = any(),
                reportedUserId = otherUserId,
                reportedUserName = any(),
                reportedUserUniqueId = any(),
                conversationId = conversationId,
                messageId = "msg-r",
                messageText = "Bad msg",
                reason = "spam",
                description = "It's spam"
            )
        }
        assertEquals("Report submitted", vm.uiState.value.successMessage)
    }

    @Test
    fun `reportMessage sets error on failure`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { reportRepository.reportMessage(any(), any(), any(), any(), any(), any(), any(), any(), any(), any(), any()) } returns
                Resource.Error("report failed")

        val msg = TestData.createTestPrivateMessage(messageId = "msg-r", senderId = otherUserId)
        vm.reportMessage(msg, "spam", "desc")
        advanceUntilIdle()

        assertEquals("Failed to submit report", vm.uiState.value.error)
    }

    // ===== clearError =====

    @Test
    fun `clearError clears error state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        ModerationFilter.updateProhibitedWords(listOf("badword"))
        vm.sendMessage("badword")
        advanceUntilIdle()
        assertNotNull(vm.uiState.value.error)

        vm.clearError()
        assertNull(vm.uiState.value.error)
    }

    // ===== Group Chat Init =====

    @Test
    fun `initGroupChat loads group conversation`() = runTest {
        val groupConversation = TestData.createTestConversation(
            conversationId = "group-conv",
            participantIds = listOf(currentUserId, "user-a", "user-b"),
            isGroup = true,
            groupName = "Test Group",
            groupAdminIds = listOf(currentUserId),
            createdBy = currentUserId
        )
        coEvery { pmRepository.getConversation("group-conv") } returns Resource.Success(groupConversation)

        val userA = TestData.createTestUser(uid = "user-a", displayName = "A")
        val userB = TestData.createTestUser(uid = "user-b", displayName = "B")
        val currentUser = TestData.createTestUser(uid = currentUserId, displayName = "Current")
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(currentUser, userA, userB))

        val groupMessagesFlow = MutableSharedFlow<List<PrivateMessage>>()
        every { pmRepository.getMessages("group-conv", any()) } returns groupMessagesFlow
        every { pmRepository.observeConversationSettings("group-conv", currentUserId) } returns settingsFlow

        val vm = PrivateChatViewModel(
            otherUserId = "",
            pmRepository = pmRepository,
            userRepository = userRepository,
            authRepository = authRepository,
            typingRepository = typingRepository,
            reportRepository = reportRepository,
            initialConversationId = "group-conv"
        ).also { activeViewModels.add(it) }
        advanceUntilIdle()

        val state = vm.uiState.value
        assertTrue(state.isGroup)
        assertEquals("Test Group", state.conversationName)
        assertTrue(state.isAdmin)
        assertEquals("group-conv", state.conversationId)
        assertFalse(state.isLoading)
    }

    // ===== Pagination =====

    @Test
    fun `loadOlderMessages merges with existing messages`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        // Emit live messages
        val liveMsg = TestData.createTestPrivateMessage(messageId = "m2", createdAt = 2_000_000_000L)
        messagesFlow.emit(listOf(liveMsg))
        advanceUntilIdle()

        assertEquals(1, vm.uiState.value.messages.size)

        // Load older messages
        val olderMsg = TestData.createTestPrivateMessage(messageId = "m1", createdAt = 1_000_000_000L)
        coEvery { pmRepository.loadOlderMessages(any(), any(), any()) } returns Resource.Success(listOf(olderMsg))

        vm.loadOlderMessages()
        advanceUntilIdle()

        assertEquals(2, vm.uiState.value.messages.size)
        assertEquals("m1", vm.uiState.value.messages[0].messageId)
        assertEquals("m2", vm.uiState.value.messages[1].messageId)
    }

    @Test
    fun `loadOlderMessages sets hasOlderMessages false when underfull`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val liveMsg = TestData.createTestPrivateMessage(messageId = "m2", createdAt = 2_000_000_000L)
        messagesFlow.emit(listOf(liveMsg))
        advanceUntilIdle()

        coEvery { pmRepository.loadOlderMessages(any(), any(), any()) } returns Resource.Success(listOf(
            TestData.createTestPrivateMessage(messageId = "m1", createdAt = 1_000_000_000L)
        ))

        vm.loadOlderMessages()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.hasOlderMessages)
    }

    @Test
    fun `loadOlderMessages does not run when messages empty`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        // No messages emitted — messages list is empty
        coEvery { pmRepository.loadOlderMessages(any(), any(), any()) } returns Resource.Success(emptyList())

        vm.loadOlderMessages()
        advanceUntilIdle()

        coVerify(exactly = 0) { pmRepository.loadOlderMessages(any(), any(), any()) }
    }

    // ===== Image Upload =====

    @Test
    fun `uploadAndSendImages rejects empty list`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.uploadAndSendImages(emptyList())
        advanceUntilIdle()

        coVerify(exactly = 0) { storageRepository.uploadImage(any(), any(), any()) }
    }

    @Test
    fun `uploadAndSendImages rejects over max images`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val tooMany = (1..Constants.PM_MAX_IMAGES_PER_MESSAGE + 1).map { ByteArray(1) }
        vm.uploadAndSendImages(tooMany)
        advanceUntilIdle()

        coVerify(exactly = 0) { storageRepository.uploadImage(any(), any(), any()) }
    }

    // ===== Sticker =====

    @Test
    fun `toggleStickerPicker toggles state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.showStickerPicker)
        vm.toggleStickerPicker()
        assertTrue(vm.uiState.value.showStickerPicker)
        vm.toggleStickerPicker()
        assertFalse(vm.uiState.value.showStickerPicker)
    }

    @Test
    fun `sendSticker calls repo with correct params`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.sendStickerMessage(any(), any(), any(), any()) } returns Resource.Success(Unit)

        vm.sendSticker("https://sticker.png")
        advanceUntilIdle()

        coVerify {
            pmRepository.sendStickerMessage(
                conversationId = conversationId,
                senderId = currentUserId,
                senderName = "Current",
                stickerUrl = "https://sticker.png"
            )
        }
        assertFalse(vm.uiState.value.showStickerPicker)
    }

    @Test
    fun `sendSticker does nothing without conversationId`() = runTest {
        coEvery { pmRepository.getOrCreateConversation(currentUserId, otherUserId) } returns
                Resource.Error("network error")

        val vm = createViewModel()
        advanceUntilIdle()

        vm.sendSticker("https://sticker.png")
        advanceUntilIdle()

        coVerify(exactly = 0) { pmRepository.sendStickerMessage(any(), any(), any(), any()) }
    }

    // ===== Group Management =====

    @Test
    fun `updateGroupName calls repo`() = runTest {
        val groupConversation = TestData.createTestConversation(
            conversationId = "group-conv",
            participantIds = listOf(currentUserId, "user-a"),
            isGroup = true,
            groupName = "Old Name",
            createdBy = currentUserId
        )
        coEvery { pmRepository.getConversation("group-conv") } returns Resource.Success(groupConversation)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(emptyList())

        val groupMessagesFlow = MutableSharedFlow<List<PrivateMessage>>()
        every { pmRepository.getMessages("group-conv", any()) } returns groupMessagesFlow
        every { pmRepository.observeConversationSettings("group-conv", currentUserId) } returns settingsFlow

        coEvery { pmRepository.updateGroupName("group-conv", "New Name") } returns Resource.Success(Unit)

        val vm = PrivateChatViewModel(
            otherUserId = "",
            pmRepository = pmRepository,
            userRepository = userRepository,
            authRepository = authRepository,
            typingRepository = typingRepository,
            reportRepository = reportRepository,
            initialConversationId = "group-conv"
        ).also { activeViewModels.add(it) }
        advanceUntilIdle()

        vm.updateGroupName("New Name")
        advanceUntilIdle()

        coVerify { pmRepository.updateGroupName("group-conv", "New Name") }
        assertEquals("New Name", vm.uiState.value.conversationName)
    }

    @Test
    fun `updateGroupName rejects blank name`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.updateGroupName("   ")
        advanceUntilIdle()

        coVerify(exactly = 0) { pmRepository.updateGroupName(any(), any()) }
    }

    @Test
    fun `leaveGroup calls closeGroupConversation for admin`() = runTest {
        val groupConversation = TestData.createTestConversation(
            conversationId = "group-conv",
            participantIds = listOf(currentUserId),
            isGroup = true,
            createdBy = currentUserId
        )
        coEvery { pmRepository.getConversation("group-conv") } returns Resource.Success(groupConversation)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(emptyList())

        val groupMessagesFlow = MutableSharedFlow<List<PrivateMessage>>()
        every { pmRepository.getMessages("group-conv", any()) } returns groupMessagesFlow
        every { pmRepository.observeConversationSettings("group-conv", currentUserId) } returns settingsFlow

        coEvery { pmRepository.closeGroupConversation("group-conv") } returns Resource.Success(Unit)

        val vm = PrivateChatViewModel(
            otherUserId = "",
            pmRepository = pmRepository,
            userRepository = userRepository,
            authRepository = authRepository,
            typingRepository = typingRepository,
            reportRepository = reportRepository,
            initialConversationId = "group-conv"
        ).also { activeViewModels.add(it) }
        advanceUntilIdle()

        vm.leaveGroup()
        advanceUntilIdle()

        coVerify { pmRepository.closeGroupConversation("group-conv") }
    }

    // ===== Messages flow =====

    @Test
    fun `messages flow updates state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msgs = listOf(
            TestData.createTestPrivateMessage(messageId = "m1"),
            TestData.createTestPrivateMessage(messageId = "m2")
        )
        messagesFlow.emit(msgs)
        advanceUntilIdle()

        assertEquals(2, vm.uiState.value.messages.size)
        assertEquals("m1", vm.uiState.value.messages[0].messageId)
    }

    // ===== Settings flow =====

    @Test
    fun `settings flow updates mute and pin state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        settingsFlow.emit(ConversationSettings(isMuted = true, isPinned = true))
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isMuted)
        assertTrue(vm.uiState.value.isPinned)
    }

    // ===== Sticker Storage Integration =====

    private fun createViewModelWithStickerStorage(): PrivateChatViewModel {
        return PrivateChatViewModel(
            otherUserId = otherUserId,
            pmRepository = pmRepository,
            userRepository = userRepository,
            authRepository = authRepository,
            typingRepository = typingRepository,
            reportRepository = reportRepository,
            storageRepository = storageRepository,
            stickerStorage = stickerStorage
        )
    }

    @Test
    fun `toggleStickerPicker loads stickers from storage when opening`() = runTest {
        val sticker1 = Sticker(id = "s1", url = "", localPath = "/path/s1.jpg")
        val sticker2 = Sticker(id = "s2", url = "", localPath = "/path/s2.jpg")
        every { stickerStorage.getStickers() } returns listOf(sticker1, sticker2)

        val vm = createViewModelWithStickerStorage()
        advanceUntilIdle()

        vm.toggleStickerPicker()

        assertTrue(vm.uiState.value.showStickerPicker)
        assertEquals(2, vm.uiState.value.stickers.size)
        assertEquals("s1", vm.uiState.value.stickers[0].id)
    }

    @Test
    fun `toggleStickerPicker does not load stickers when closing`() = runTest {
        every { stickerStorage.getStickers() } returns emptyList()

        val vm = createViewModelWithStickerStorage()
        advanceUntilIdle()

        vm.toggleStickerPicker() // open
        assertTrue(vm.uiState.value.showStickerPicker)

        vm.toggleStickerPicker() // close
        assertFalse(vm.uiState.value.showStickerPicker)
    }

    @Test
    fun `sendSticker with Sticker object using URL sends directly`() = runTest {
        val vm = createViewModelWithStickerStorage()
        advanceUntilIdle()

        coEvery { pmRepository.sendStickerMessage(any(), any(), any(), any()) } returns Resource.Success(Unit)

        val sticker = Sticker(id = "s1", url = "https://sticker.png")
        vm.sendSticker(sticker)
        advanceUntilIdle()

        coVerify {
            pmRepository.sendStickerMessage(
                conversationId = conversationId,
                senderId = currentUserId,
                senderName = "Current",
                stickerUrl = "https://sticker.png"
            )
        }
        verify { stickerStorage.markAsRecent("s1") }
        assertFalse(vm.uiState.value.showStickerPicker)
    }

    @Test
    fun `sendSticker with Sticker object marks as recent`() = runTest {
        val vm = createViewModelWithStickerStorage()
        advanceUntilIdle()

        coEvery { pmRepository.sendStickerMessage(any(), any(), any(), any()) } returns Resource.Success(Unit)

        val sticker = Sticker(id = "recent-sticker", url = "https://example.png")
        vm.sendSticker(sticker)
        advanceUntilIdle()

        verify { stickerStorage.markAsRecent("recent-sticker") }
    }

    @Test
    fun `sendSticker with Sticker object without conversationId does nothing`() = runTest {
        coEvery { pmRepository.getOrCreateConversation(currentUserId, otherUserId) } returns
                Resource.Error("network error")

        val vm = createViewModelWithStickerStorage()
        advanceUntilIdle()

        val sticker = Sticker(id = "s1", url = "https://sticker.png")
        vm.sendSticker(sticker)
        advanceUntilIdle()

        coVerify(exactly = 0) { pmRepository.sendStickerMessage(any(), any(), any(), any()) }
    }

    @Test
    fun `addStickerFromImage saves to storage and refreshes lists`() = runTest {
        val savedSticker = Sticker(id = "new-id", url = "", localPath = "/path/new.jpg")
        every { stickerStorage.addSticker(any(), any()) } returns savedSticker
        every { stickerStorage.getStickers() } returns listOf(savedSticker)

        val vm = createViewModelWithStickerStorage()
        advanceUntilIdle()

        vm.addStickerFromImage(byteArrayOf(1, 2, 3))

        verify { stickerStorage.addSticker(any(), eq(byteArrayOf(1, 2, 3))) }
        assertEquals(1, vm.uiState.value.stickers.size)
    }

    @Test
    fun `addStickerFromImage does nothing without stickerStorage`() = runTest {
        // Use default ViewModel (no stickerStorage)
        val vm = createViewModel()
        advanceUntilIdle()

        vm.addStickerFromImage(byteArrayOf(1, 2, 3))

        verify(exactly = 0) { stickerStorage.addSticker(any(), any()) }
    }

    // ===== Recall Message =====

    @Test
    fun `recallMessage calls repo with correct params`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.recallMessage(any(), any()) } returns Resource.Success(Unit)

        vm.recallMessage("msg-to-recall")
        advanceUntilIdle()

        coVerify { pmRepository.recallMessage(conversationId, "msg-to-recall") }
    }

    @Test
    fun `recallMessage sets error on failure`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.recallMessage(any(), any()) } returns Resource.Error("recall failed")

        vm.recallMessage("msg-to-recall")
        advanceUntilIdle()

        assertEquals("Failed to recall message", vm.uiState.value.error)
    }

    @Test
    fun `recallMessage does nothing without conversationId`() = runTest {
        coEvery { pmRepository.getOrCreateConversation(currentUserId, otherUserId) } returns
                Resource.Error("network error")

        val vm = createViewModel()
        advanceUntilIdle()

        vm.recallMessage("msg-to-recall")
        advanceUntilIdle()

        coVerify(exactly = 0) { pmRepository.recallMessage(any(), any()) }
    }

    // ===== Close Sticker Picker =====

    @Test
    fun `closeStickerPicker closes picker`() = runTest {
        val vm = createViewModelWithStickerStorage()
        advanceUntilIdle()

        vm.toggleStickerPicker() // open
        assertTrue(vm.uiState.value.showStickerPicker)

        vm.closeStickerPicker()
        assertFalse(vm.uiState.value.showStickerPicker)
    }

    @Test
    fun `closeStickerPicker is no-op when already closed`() = runTest {
        val vm = createViewModelWithStickerStorage()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.showStickerPicker)
        vm.closeStickerPicker()
        assertFalse(vm.uiState.value.showStickerPicker)
    }

    // ===== Optimistic Sending =====

    @Test
    fun `uploadAndSendImages shows pending message immediately`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        // Emit initial live messages so we have a non-empty list
        messagesFlow.emit(emptyList())
        advanceUntilIdle()

        // Make upload hang forever so the pending message stays visible
        coEvery { storageRepository.uploadImage(any(), any(), any()) } coAnswers {
            kotlinx.coroutines.awaitCancellation()
        }

        vm.uploadAndSendImages(listOf(byteArrayOf(1, 2, 3)))
        // Allow Dispatchers.Default (compressImage) to complete and return to Main
        kotlinx.coroutines.yield()
        advanceUntilIdle()

        // Pending message should appear in the messages list
        val messages = vm.uiState.value.messages
        assertTrue(messages.any { it.messageId.startsWith("temp_") })
        val pending = messages.first { it.messageId.startsWith("temp_") }
        assertEquals(com.shyden.shytalk.core.model.SendStatus.SENDING, pending.sendStatus)
        assertEquals(PrivateMessageType.IMAGE, pending.type)

        // Cancel viewModelScope to prevent coroutines leaking past Dispatchers.resetMain()
        vm.viewModelScope.cancel()
    }

    // ===== Toggle Mute =====

    @Test
    fun `toggleMute calls muteConversation with true when currently unmuted`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        // State starts with isMuted = false
        vm.toggleMute()
        advanceUntilIdle()
        coVerify { pmRepository.muteConversation(conversationId, currentUserId, true) }
    }

    @Test
    fun `toggleMute calls muteConversation with false when currently muted`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        settingsFlow.emit(ConversationSettings(userId = currentUserId, isMuted = true))
        advanceUntilIdle()
        vm.toggleMute()
        advanceUntilIdle()
        coVerify { pmRepository.muteConversation(conversationId, currentUserId, false) }
    }

    // ===== Toggle Pin =====

    @Test
    fun `togglePin calls pinConversation with true when currently unpinned`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        vm.togglePin()
        advanceUntilIdle()
        coVerify { pmRepository.pinConversation(conversationId, currentUserId, true) }
    }

    @Test
    fun `togglePin calls pinConversation with false when currently pinned`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        settingsFlow.emit(ConversationSettings(userId = currentUserId, isPinned = true))
        advanceUntilIdle()
        vm.togglePin()
        advanceUntilIdle()
        coVerify { pmRepository.pinConversation(conversationId, currentUserId, false) }
    }

    // ===== Recall Message =====

    @Test
    fun `recallMessage calls repository`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        vm.recallMessage("msg-1")
        advanceUntilIdle()
        coVerify { pmRepository.recallMessage(conversationId, "msg-1") }
    }

    // ===== Mute Group Member =====

    @Test
    fun `muteGroupMember success reloads mutes`() = runTest {
        coEvery { pmRepository.muteGroupMember(conversationId, "target-user", any(), any()) } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()
        vm.muteGroupMember("target-user", Constants.MUTE_DURATION_5MIN, "spam")
        advanceUntilIdle()
        coVerify { pmRepository.muteGroupMember(conversationId, "target-user", Constants.MUTE_DURATION_5MIN, "spam") }
    }

    @Test
    fun `muteGroupMember failure sets error`() = runTest {
        coEvery { pmRepository.muteGroupMember(conversationId, "target-user", any(), any()) } returns Resource.Error("fail")
        val vm = createViewModel()
        advanceUntilIdle()
        vm.muteGroupMember("target-user", Constants.MUTE_DURATION_5MIN, null)
        advanceUntilIdle()
        assertEquals("Failed to mute member", vm.uiState.value.error)
    }

    // ===== Unmute Group Member =====

    @Test
    fun `unmuteGroupMember success reloads mutes`() = runTest {
        coEvery { pmRepository.unmuteGroupMember(conversationId, "target-user") } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()
        vm.unmuteGroupMember("target-user")
        advanceUntilIdle()
        coVerify { pmRepository.unmuteGroupMember(conversationId, "target-user") }
    }

    @Test
    fun `unmuteGroupMember failure sets error`() = runTest {
        coEvery { pmRepository.unmuteGroupMember(conversationId, "target-user") } returns Resource.Error("fail")
        val vm = createViewModel()
        advanceUntilIdle()
        vm.unmuteGroupMember("target-user")
        advanceUntilIdle()
        assertEquals("Failed to unmute member", vm.uiState.value.error)
    }

    // ===== Hide Message =====

    @Test
    fun `hideMessage success sends mod action message`() = runTest {
        coEvery { pmRepository.hideMessage(conversationId, "msg-1", currentUserId) } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()
        vm.hideMessage("msg-1")
        advanceUntilIdle()
        coVerify { pmRepository.hideMessage(conversationId, "msg-1", currentUserId) }
    }

    @Test
    fun `hideMessage failure sets error`() = runTest {
        coEvery { pmRepository.hideMessage(conversationId, "msg-1", currentUserId) } returns Resource.Error("fail")
        val vm = createViewModel()
        advanceUntilIdle()
        vm.hideMessage("msg-1")
        advanceUntilIdle()
        assertEquals("Failed to hide message", vm.uiState.value.error)
    }

    // ===== Transfer Ownership =====

    @Test
    fun `transferOwnership success reinitializes group`() = runTest {
        coEvery { pmRepository.transferOwnership(conversationId, "new-owner") } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()
        vm.transferOwnership("new-owner")
        advanceUntilIdle()
        coVerify { pmRepository.transferOwnership(conversationId, "new-owner") }
    }

    @Test
    fun `transferOwnership failure sets error`() = runTest {
        coEvery { pmRepository.transferOwnership(conversationId, "new-owner") } returns Resource.Error("fail")
        val vm = createViewModel()
        advanceUntilIdle()
        vm.transferOwnership("new-owner")
        advanceUntilIdle()
        assertEquals("Failed to transfer ownership", vm.uiState.value.error)
    }

    // ===== Update Group Roles =====

    @Test
    fun `updateGroupRoles success reinitializes group`() = runTest {
        coEvery { pmRepository.updateGroupRoles(conversationId, listOf("admin1"), listOf("mod1")) } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()
        vm.updateGroupRoles(listOf("admin1"), listOf("mod1"))
        advanceUntilIdle()
        coVerify { pmRepository.updateGroupRoles(conversationId, listOf("admin1"), listOf("mod1")) }
    }

    @Test
    fun `updateGroupRoles failure sets error`() = runTest {
        coEvery { pmRepository.updateGroupRoles(conversationId, any(), any()) } returns Resource.Error("fail")
        val vm = createViewModel()
        advanceUntilIdle()
        vm.updateGroupRoles(listOf("a"), listOf("m"))
        advanceUntilIdle()
        assertEquals("Failed to update roles", vm.uiState.value.error)
    }

    // ===== Send Room Invite =====

    @Test
    fun `sendRoomInvite calls repository`() = runTest {
        coEvery { pmRepository.sendRoomInviteMessage(any(), any(), any(), any(), any()) } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()
        vm.sendRoomInvite("room-1", "Cool Room")
        advanceUntilIdle()
        coVerify { pmRepository.sendRoomInviteMessage(conversationId, currentUserId, any(), "room-1", "Cool Room") }
    }

    @Test
    fun `sendRoomInvite failure sets error`() = runTest {
        coEvery { pmRepository.sendRoomInviteMessage(any(), any(), any(), any(), any()) } returns Resource.Error("fail")
        val vm = createViewModel()
        advanceUntilIdle()
        vm.sendRoomInvite("room-1", "Room")
        advanceUntilIdle()
        assertEquals("Failed to send room invite", vm.uiState.value.error)
    }

    // ===== Leave Group =====

    @Test
    fun `leaveGroup as non-admin calls removeGroupParticipant`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()
        // Default state has isAdmin = false
        vm.leaveGroup()
        advanceUntilIdle()
        coVerify { pmRepository.removeGroupParticipant(conversationId, currentUserId) }
    }

    // ===== Update Group Permissions =====

    @Test
    fun `updateGroupPermissions calls repository`() = runTest {
        val perms = GroupPermissions()
        coEvery { pmRepository.updateGroupPermissions(conversationId, perms) } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()
        vm.updateGroupPermissions(perms)
        advanceUntilIdle()
        coVerify { pmRepository.updateGroupPermissions(conversationId, perms) }
    }

    // ===== Update Group Description =====

    @Test
    fun `updateGroupDescription calls repository`() = runTest {
        coEvery { pmRepository.updateGroupDescription(conversationId, "New desc") } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()
        vm.updateGroupDescription("New desc")
        advanceUntilIdle()
        coVerify { pmRepository.updateGroupDescription(conversationId, "New desc") }
    }

    // ===== Update Group Photo =====

    @Test
    fun `updateGroupPhoto calls repository`() = runTest {
        coEvery { pmRepository.updateGroupPhoto(conversationId, "https://photo.url") } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()
        vm.updateGroupPhoto("https://photo.url")
        advanceUntilIdle()
        coVerify { pmRepository.updateGroupPhoto(conversationId, "https://photo.url") }
    }

    // ===== Update System Message Config =====

    @Test
    fun `updateSystemMessageConfig calls repository`() = runTest {
        val config = SystemMessageConfig()
        coEvery { pmRepository.updateSystemMessageConfig(conversationId, config) } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()
        vm.updateSystemMessageConfig(config)
        advanceUntilIdle()
        coVerify { pmRepository.updateSystemMessageConfig(conversationId, config) }
    }

    // ===== Update Mod Notify Mode =====

    @Test
    fun `updateModNotifyMode calls repository`() = runTest {
        coEvery { pmRepository.updateModNotifyMode(conversationId, "ALL_ADMINS") } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()
        vm.updateModNotifyMode("ALL_ADMINS")
        advanceUntilIdle()
        coVerify { pmRepository.updateModNotifyMode(conversationId, "ALL_ADMINS") }
    }

    // ===== Add/Remove Group Participant =====

    @Test
    fun `addGroupParticipant calls repository`() = runTest {
        coEvery { pmRepository.addGroupParticipant(conversationId, "new-user") } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()
        vm.addGroupParticipant("new-user")
        advanceUntilIdle()
        coVerify { pmRepository.addGroupParticipant(conversationId, "new-user") }
    }

    @Test
    fun `removeGroupParticipant calls repository`() = runTest {
        coEvery { pmRepository.removeGroupParticipant(conversationId, "target-user") } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()
        vm.removeGroupParticipant("target-user")
        advanceUntilIdle()
        coVerify { pmRepository.removeGroupParticipant(conversationId, "target-user") }
    }

    @Test
    fun `updateGroupName calls repository`() = runTest {
        coEvery { pmRepository.updateGroupName(conversationId, "New Name") } returns Resource.Success(Unit)
        val vm = createViewModel()
        advanceUntilIdle()
        vm.updateGroupName("New Name")
        advanceUntilIdle()
        coVerify { pmRepository.updateGroupName(conversationId, "New Name") }
    }

    // ===== markMessagesAsRead =====

    @Test
    fun `markMessagesAsRead calls repo when last message from other user is unread`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val otherMsg = TestData.createTestPrivateMessage(
            messageId = "msg-other",
            senderId = otherUserId,
            readBy = emptyList()
        )
        messagesFlow.emit(listOf(otherMsg))
        advanceUntilIdle()

        vm.markMessagesAsRead()
        advanceUntilIdle()

        coVerify { pmRepository.markAsRead(conversationId, currentUserId, "msg-other") }
    }

    @Test
    fun `markMessagesAsRead does not call repo when no messages from other user`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val myMsg = TestData.createTestPrivateMessage(
            messageId = "msg-mine",
            senderId = currentUserId
        )
        messagesFlow.emit(listOf(myMsg))
        advanceUntilIdle()

        vm.markMessagesAsRead()
        advanceUntilIdle()

        coVerify(exactly = 0) { pmRepository.markAsRead(any(), any(), any()) }
    }

    @Test
    fun `markMessagesAsRead does not call repo when already read`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val otherMsg = TestData.createTestPrivateMessage(
            messageId = "msg-other",
            senderId = otherUserId,
            readBy = listOf(currentUserId)
        )
        messagesFlow.emit(listOf(otherMsg))
        advanceUntilIdle()

        vm.markMessagesAsRead()
        advanceUntilIdle()

        coVerify(exactly = 0) { pmRepository.markAsRead(any(), any(), any()) }
    }

    // ===== refreshMessages =====

    @Test
    fun `refreshMessages sets isRefreshing and re-subscribes`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.refreshMessages()
        // isRefreshing should be set immediately
        assertTrue(vm.uiState.value.isRefreshing)

        advanceUntilIdle()

        // After delay completes, isRefreshing should be cleared
        assertFalse(vm.uiState.value.isRefreshing)
    }

    // ===== getEditHistory =====

    @Test
    fun `getEditHistory returns edit history from repository`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val edits = listOf(
            MessageEdit(editId = "e1", previousText = "old text", editedAt = 1000L),
            MessageEdit(editId = "e2", previousText = "older text", editedAt = 500L)
        )
        coEvery { pmRepository.getEditHistory(conversationId, "msg-1") } returns Resource.Success(edits)

        val result = vm.getEditHistory("msg-1")

        assertEquals(2, result.size)
        assertEquals("old text", result[0].previousText)
        coVerify { pmRepository.getEditHistory(conversationId, "msg-1") }
    }

    @Test
    fun `getEditHistory returns empty list on error`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        coEvery { pmRepository.getEditHistory(conversationId, "msg-1") } returns Resource.Error("not found")

        val result = vm.getEditHistory("msg-1")

        assertTrue(result.isEmpty())
    }

    // ===== deleteSticker =====

    @Test
    fun `deleteSticker calls stickerStorage removeSticker and refreshes list`() = runTest {
        every { stickerStorage.getStickers() } returns emptyList()

        val vm = createViewModelWithStickerStorage()
        advanceUntilIdle()

        vm.deleteSticker("s1")

        verify { stickerStorage.removeSticker("s1") }
        verify { stickerStorage.getStickers() }
    }

    @Test
    fun `deleteSticker does nothing without stickerStorage`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.deleteSticker("s1")

        verify(exactly = 0) { stickerStorage.removeSticker(any()) }
    }

    // ===== moveStickerToFront =====

    @Test
    fun `moveStickerToFront calls stickerStorage moveSticker and refreshes list`() = runTest {
        every { stickerStorage.getStickers() } returns emptyList()

        val vm = createViewModelWithStickerStorage()
        advanceUntilIdle()

        vm.moveStickerToFront("s1")

        verify { stickerStorage.moveSticker("s1", 0) }
        verify { stickerStorage.getStickers() }
    }

    @Test
    fun `moveStickerToFront does nothing without stickerStorage`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.moveStickerToFront("s1")

        verify(exactly = 0) { stickerStorage.moveSticker(any(), any()) }
    }

    // ===== submitEdit error =====

    @Test
    fun `submitEdit error sets error state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msg = TestData.createTestPrivateMessage(
            messageId = "msg-edit-err",
            senderId = currentUserId,
            createdAt = System.currentTimeMillis()
        )
        vm.startEditing(msg)

        coEvery { pmRepository.editMessage(any(), any(), any()) } returns Resource.Error("edit failed")
        vm.submitEdit("Updated text")
        advanceUntilIdle()

        assertEquals("Failed to edit message", vm.uiState.value.error)
        assertNull(vm.uiState.value.editingMessageId)
    }

    @Test
    fun `submitEdit success clears editing state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msg = TestData.createTestPrivateMessage(
            messageId = "msg-edit-ok",
            senderId = currentUserId,
            createdAt = System.currentTimeMillis()
        )
        vm.startEditing(msg)
        assertEquals("msg-edit-ok", vm.uiState.value.editingMessageId)

        coEvery { pmRepository.editMessage(any(), any(), any()) } returns Resource.Success(Unit)
        vm.submitEdit("New text")
        advanceUntilIdle()

        assertNull(vm.uiState.value.editingMessageId)
        assertEquals("", vm.uiState.value.editingOriginalText)
        assertNull(vm.uiState.value.error)
    }

    @Test
    fun `submitEdit rejects empty text`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msg = TestData.createTestPrivateMessage(
            messageId = "msg-edit-empty",
            senderId = currentUserId,
            createdAt = System.currentTimeMillis()
        )
        vm.startEditing(msg)

        vm.submitEdit("   ")
        advanceUntilIdle()

        coVerify(exactly = 0) { pmRepository.editMessage(any(), any(), any()) }
    }

    // ===== Delete / Recall removes message from live list =====

    @Test
    fun `recallMessage success removes message via flow update`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val msg1 = TestData.createTestPrivateMessage(messageId = "m1", createdAt = 1_000L)
        val msg2 = TestData.createTestPrivateMessage(messageId = "m2", createdAt = 2_000L)
        messagesFlow.emit(listOf(msg1, msg2))
        advanceUntilIdle()
        assertEquals(2, vm.uiState.value.messages.size)

        coEvery { pmRepository.recallMessage(any(), any()) } returns Resource.Success(Unit)
        vm.recallMessage("m1")
        advanceUntilIdle()

        coVerify { pmRepository.recallMessage(conversationId, "m1") }
        // Simulate Firestore removing the message from the live flow
        messagesFlow.emit(listOf(msg2))
        advanceUntilIdle()

        assertEquals(1, vm.uiState.value.messages.size)
        assertEquals("m2", vm.uiState.value.messages[0].messageId)
    }

    // ===== Typing indicator =====

    @Test
    fun `onTextChanged sends typing indicator with correct params`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.onTextChanged()

        verify { typingRepository.setTyping(conversationId, currentUserId, true) }
    }

    // ===== Empty message not sent =====

    @Test
    fun `sendMessage with whitespace-only text does not send`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.sendMessage("   \t  ")
        advanceUntilIdle()

        coVerify(exactly = 0) { pmRepository.sendTextMessage(any(), any(), any(), any(), any(), any(), any()) }
    }

    // ===== observeMessages error handling =====

    @Test
    fun `observeMessages sets error state when flow throws exception`() = runTest {
        // Use a flow that throws after emitting
        val errorFlow = flow<List<PrivateMessage>> {
            throw RuntimeException("PERMISSION_DENIED: missing or insufficient permissions")
        }
        every { pmRepository.getMessages(conversationId, any()) } returns errorFlow

        val vm = createViewModel()
        advanceUntilIdle()

        assertNotNull("Should set error when messages flow throws", vm.uiState.value.error)
    }

    @Test
    fun `initOneOnOneChat sets isLoading false even when conversation fetch fails`() = runTest {
        coEvery { pmRepository.getOrCreateConversation(currentUserId, otherUserId) } returns
                Resource.Error("Failed to get or create conversation")

        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse("isLoading should be false after failure", vm.uiState.value.isLoading)
        assertNotNull("error should be set", vm.uiState.value.error)
    }

    // ===== Empty state (Bug 9: loading spinner stuck) =====

    @Test
    fun `isLoading is false after conversation loaded with no messages`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        // Emit empty messages from the Firestore listener
        messagesFlow.emit(emptyList())
        advanceUntilIdle()

        assertFalse("isLoading should be false after init completes", vm.uiState.value.isLoading)
        assertTrue("messages should be empty", vm.uiState.value.messages.isEmpty())
        assertNull("error should be null when no error occurred", vm.uiState.value.error)
    }

    @Test
    fun `isLoading is false after successful init completes`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse("isLoading should be false after init completes", vm.uiState.value.isLoading)
        assertEquals("conversationId should be set", conversationId, vm.uiState.value.conversationId)
    }

    @Test
    fun `empty messages list does not show error state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        messagesFlow.emit(emptyList())
        advanceUntilIdle()

        val state = vm.uiState.value
        assertFalse("isLoading should be false", state.isLoading)
        assertTrue("messages should be empty", state.messages.isEmpty())
        assertNull("error should be null for empty messages (not an error)", state.error)
        assertFalse("isBlocked should be false", state.isBlocked)
    }
}
