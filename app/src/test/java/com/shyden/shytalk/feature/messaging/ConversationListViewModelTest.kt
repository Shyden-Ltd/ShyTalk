package com.shyden.shytalk.feature.messaging

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.ConversationSettings
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.PrivateMessageRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class ConversationListViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val authRepository = mockk<AuthRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val pmRepository = mockk<PrivateMessageRepository>(relaxed = true)

    private val currentUserId = "current-user"
    private val conversationsFlow = MutableSharedFlow<List<com.shyden.shytalk.core.model.Conversation>>()

    private val activeViewModels = mutableListOf<ConversationListViewModel>()

    @Before
    fun setup() {
        every { authRepository.currentUserId } returns currentUserId

        val currentUser = TestData.createTestUser(uid = currentUserId)
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(currentUser)
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(emptyList())

        every { pmRepository.getConversations(currentUserId) } returns conversationsFlow
    }

    @After
    fun tearDown() = runBlocking {
        activeViewModels.forEach { it.viewModelScope.coroutineContext.job.cancelAndJoin() }
        activeViewModels.clear()
    }

    private fun createViewModel(): ConversationListViewModel {
        return ConversationListViewModel(
            pmRepository = pmRepository,
            userRepository = userRepository,
            authRepository = authRepository
        ).also { activeViewModels.add(it) }
    }

    // ===== Init =====

    @Test
    fun `init with valid user starts observing`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.isLoading)
        assertEquals(currentUserId, vm.currentUserId)
    }

    @Test
    fun `init with no auth user does not observe`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = ConversationListViewModel(
            pmRepository = pmRepository,
            userRepository = userRepository,
            authRepository = mockk { every { currentUserId } returns null }
        ).also { activeViewModels.add(it) }
        advanceUntilIdle()

        assertEquals("", vm.currentUserId)
    }

    // ===== Conversations flow =====

    @Test
    fun `conversations flow updates state`() = runTest {
        val otherUser = TestData.createTestUser(uid = "other-user", displayName = "Other")
        coEvery { userRepository.getUsers(listOf("other-user")) } returns Resource.Success(listOf(otherUser))

        val settings = TestData.createTestConversationSettings(userId = currentUserId, unreadCount = 3)
        coEvery { pmRepository.getConversationSettings(any(), currentUserId) } returns Resource.Success(settings)

        val vm = createViewModel()
        advanceUntilIdle()

        val conv = TestData.createTestConversation(
            conversationId = "conv-1",
            participantIds = listOf(currentUserId, "other-user")
        )
        conversationsFlow.emit(listOf(conv))
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isLoading)
        assertEquals(1, vm.uiState.value.conversations.size)
        assertEquals("conv-1", vm.uiState.value.conversations[0].conversation.conversationId)
        assertEquals(3L, vm.uiState.value.totalUnreadCount)
    }

    @Test
    fun `conversations flow error sets error state without crash`() = runTest {
        every { pmRepository.getConversations(currentUserId) } returns flow {
            throw RuntimeException("FAILED_PRECONDITION: index required")
        }

        val vm = ConversationListViewModel(
            pmRepository = pmRepository,
            userRepository = userRepository,
            authRepository = authRepository
        ).also { activeViewModels.add(it) }
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isLoading)
        assertEquals("FAILED_PRECONDITION: index required", vm.uiState.value.error)
    }

    // ===== Blocked conversations filtered =====

    @Test
    fun `blocked conversations are filtered out`() = runTest {
        val currentUser = TestData.createTestUser(uid = currentUserId, blockedUserIds = setOf("blocked-user"))
        coEvery { userRepository.getUser(currentUserId) } returns Resource.Success(currentUser)

        val blockedUser = TestData.createTestUser(uid = "blocked-user")
        coEvery { userRepository.getUsers(listOf("blocked-user")) } returns Resource.Success(listOf(blockedUser))

        val vm = createViewModel()
        advanceUntilIdle()

        val conv = TestData.createTestConversation(
            conversationId = "conv-blocked",
            participantIds = listOf(currentUserId, "blocked-user")
        )
        conversationsFlow.emit(listOf(conv))
        advanceUntilIdle()

        assertEquals(0, vm.uiState.value.conversations.size)
    }

    // ===== Hidden conversations filtered =====

    @Test
    fun `hidden conversations are filtered when no new messages`() = runTest {
        val otherUser = TestData.createTestUser(uid = "other-user")
        coEvery { userRepository.getUsers(listOf("other-user")) } returns Resource.Success(listOf(otherUser))

        val settings = TestData.createTestConversationSettings(
            userId = currentUserId,
            isHidden = true,
            hiddenAt = 2_000_000_000L
        )
        coEvery { pmRepository.getConversationSettings(any(), currentUserId) } returns Resource.Success(settings)

        val vm = createViewModel()
        advanceUntilIdle()

        val conv = TestData.createTestConversation(
            conversationId = "conv-hidden",
            participantIds = listOf(currentUserId, "other-user"),
            lastMessageAt = 1_000_000_000L // before hiddenAt
        )
        conversationsFlow.emit(listOf(conv))
        advanceUntilIdle()

        assertEquals(0, vm.uiState.value.conversations.size)
    }

    @Test
    fun `hidden conversations shown when new message arrived after hiding`() = runTest {
        val otherUser = TestData.createTestUser(uid = "other-user")
        coEvery { userRepository.getUsers(listOf("other-user")) } returns Resource.Success(listOf(otherUser))

        val settings = TestData.createTestConversationSettings(
            userId = currentUserId,
            isHidden = true,
            hiddenAt = 1_000_000_000L
        )
        coEvery { pmRepository.getConversationSettings(any(), currentUserId) } returns Resource.Success(settings)

        val vm = createViewModel()
        advanceUntilIdle()

        val conv = TestData.createTestConversation(
            conversationId = "conv-unhidden",
            participantIds = listOf(currentUserId, "other-user"),
            lastMessageAt = 2_000_000_000L // after hiddenAt
        )
        conversationsFlow.emit(listOf(conv))
        advanceUntilIdle()

        assertEquals(1, vm.uiState.value.conversations.size)
    }

    // ===== Pinned sort order =====

    @Test
    fun `pinned conversations sort first`() = runTest {
        val user1 = TestData.createTestUser(uid = "user-a", displayName = "A")
        val user2 = TestData.createTestUser(uid = "user-b", displayName = "B")
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(user1, user2))

        val pinnedSettings = TestData.createTestConversationSettings(userId = currentUserId, isPinned = true)
        val normalSettings = TestData.createTestConversationSettings(userId = currentUserId, isPinned = false)

        coEvery { pmRepository.getConversationSettings("conv-normal", currentUserId) } returns Resource.Success(normalSettings)
        coEvery { pmRepository.getConversationSettings("conv-pinned", currentUserId) } returns Resource.Success(pinnedSettings)

        val vm = createViewModel()
        advanceUntilIdle()

        val convNormal = TestData.createTestConversation(
            conversationId = "conv-normal",
            participantIds = listOf(currentUserId, "user-a"),
            lastMessageAt = 2_000_000_000L
        )
        val convPinned = TestData.createTestConversation(
            conversationId = "conv-pinned",
            participantIds = listOf(currentUserId, "user-b"),
            lastMessageAt = 1_000_000_000L
        )
        conversationsFlow.emit(listOf(convNormal, convPinned))
        advanceUntilIdle()

        assertEquals(2, vm.uiState.value.conversations.size)
        assertEquals("conv-pinned", vm.uiState.value.conversations[0].conversation.conversationId)
        assertEquals("conv-normal", vm.uiState.value.conversations[1].conversation.conversationId)
    }

    // ===== Search =====

    @Test
    fun `onSearchQueryChanged updates query`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.onSearchQueryChanged("Alice")
        assertEquals("Alice", vm.uiState.value.searchQuery)
    }

    @Test
    fun `getFilteredConversations filters by display name`() = runTest {
        val userAlice = TestData.createTestUser(uid = "alice", displayName = "Alice")
        val userBob = TestData.createTestUser(uid = "bob", displayName = "Bob")
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(userAlice, userBob))
        coEvery { pmRepository.getConversationSettings(any(), currentUserId) } returns
                Resource.Success(TestData.createTestConversationSettings(userId = currentUserId))

        val vm = createViewModel()
        advanceUntilIdle()

        val convAlice = TestData.createTestConversation(
            conversationId = "conv-alice",
            participantIds = listOf(currentUserId, "alice")
        )
        val convBob = TestData.createTestConversation(
            conversationId = "conv-bob",
            participantIds = listOf(currentUserId, "bob")
        )
        conversationsFlow.emit(listOf(convAlice, convBob))
        advanceUntilIdle()

        vm.onSearchQueryChanged("Ali")
        val filtered = vm.getFilteredConversations()
        assertEquals(1, filtered.size)
        assertEquals("conv-alice", filtered[0].conversation.conversationId)
    }

    @Test
    fun `getFilteredConversations returns all when query is blank`() = runTest {
        val user = TestData.createTestUser(uid = "other")
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(user))
        coEvery { pmRepository.getConversationSettings(any(), currentUserId) } returns
                Resource.Success(TestData.createTestConversationSettings(userId = currentUserId))

        val vm = createViewModel()
        advanceUntilIdle()

        conversationsFlow.emit(listOf(
            TestData.createTestConversation(conversationId = "c1", participantIds = listOf(currentUserId, "other"))
        ))
        advanceUntilIdle()

        vm.onSearchQueryChanged("")
        assertEquals(1, vm.getFilteredConversations().size)
    }

    // ===== hideConversation =====

    @Test
    fun `hideConversation removes from UI`() = runTest {
        val user = TestData.createTestUser(uid = "other")
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(user))
        coEvery { pmRepository.getConversationSettings(any(), currentUserId) } returns
                Resource.Success(TestData.createTestConversationSettings(userId = currentUserId))
        coEvery { pmRepository.hideConversation(any(), any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()

        conversationsFlow.emit(listOf(
            TestData.createTestConversation(conversationId = "conv-1", participantIds = listOf(currentUserId, "other"))
        ))
        advanceUntilIdle()
        assertEquals(1, vm.uiState.value.conversations.size)

        vm.hideConversation("conv-1")
        advanceUntilIdle()

        assertEquals(0, vm.uiState.value.conversations.size)
        coVerify { pmRepository.hideConversation("conv-1", currentUserId) }
    }

    // ===== pinConversation =====

    @Test
    fun `pinConversation toggles pin state`() = runTest {
        val user = TestData.createTestUser(uid = "other")
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(user))
        coEvery { pmRepository.getConversationSettings(any(), currentUserId) } returns
                Resource.Success(TestData.createTestConversationSettings(userId = currentUserId, isPinned = false))
        coEvery { pmRepository.pinConversation(any(), any(), any()) } returns Resource.Success(Unit)

        val vm = createViewModel()
        advanceUntilIdle()

        conversationsFlow.emit(listOf(
            TestData.createTestConversation(conversationId = "conv-1", participantIds = listOf(currentUserId, "other"))
        ))
        advanceUntilIdle()

        vm.pinConversation("conv-1")
        advanceUntilIdle()

        coVerify { pmRepository.pinConversation("conv-1", currentUserId, true) }
        assertTrue(vm.uiState.value.conversations[0].settings?.isPinned == true)
    }

    // ===== Muted conversations unread =====

    @Test
    fun `muted conversations excluded from totalUnreadCount`() = runTest {
        val user1 = TestData.createTestUser(uid = "user-a")
        val user2 = TestData.createTestUser(uid = "user-b")
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(user1, user2))

        val mutedSettings = TestData.createTestConversationSettings(userId = currentUserId, isMuted = true, unreadCount = 5)
        val normalSettings = TestData.createTestConversationSettings(userId = currentUserId, isMuted = false, unreadCount = 3)

        coEvery { pmRepository.getConversationSettings("conv-muted", currentUserId) } returns Resource.Success(mutedSettings)
        coEvery { pmRepository.getConversationSettings("conv-normal", currentUserId) } returns Resource.Success(normalSettings)

        val vm = createViewModel()
        advanceUntilIdle()

        val convMuted = TestData.createTestConversation(
            conversationId = "conv-muted",
            participantIds = listOf(currentUserId, "user-a")
        )
        val convNormal = TestData.createTestConversation(
            conversationId = "conv-normal",
            participantIds = listOf(currentUserId, "user-b")
        )
        conversationsFlow.emit(listOf(convMuted, convNormal))
        advanceUntilIdle()

        // totalUnreadCount should only include the non-muted conversation's 3
        assertEquals(3L, vm.uiState.value.totalUnreadCount)
    }

    // ===== Group conversations in list =====

    @Test
    fun `group conversations appear in list with group fields`() = runTest {
        coEvery { pmRepository.getConversationSettings(any(), currentUserId) } returns
                Resource.Success(TestData.createTestConversationSettings(userId = currentUserId))

        val vm = createViewModel()
        advanceUntilIdle()

        val groupConv = TestData.createTestConversation(
            conversationId = "group-1",
            participantIds = listOf(currentUserId, "user-a", "user-b"),
            isGroup = true,
            groupName = "Cool Group"
        )
        conversationsFlow.emit(listOf(groupConv))
        advanceUntilIdle()

        assertEquals(1, vm.uiState.value.conversations.size)
        val cw = vm.uiState.value.conversations[0]
        assertTrue(cw.isGroup)
        assertEquals("Cool Group", cw.groupName)
    }

    @Test
    fun `closed group conversations are filtered out`() = runTest {
        coEvery { pmRepository.getConversationSettings(any(), currentUserId) } returns
                Resource.Success(TestData.createTestConversationSettings(userId = currentUserId))

        val vm = createViewModel()
        advanceUntilIdle()

        val closedGroup = TestData.createTestConversation(
            conversationId = "group-closed",
            participantIds = listOf(currentUserId, "user-a"),
            isGroup = true,
            groupName = "Closed Group",
            isClosed = true
        )
        conversationsFlow.emit(listOf(closedGroup))
        advanceUntilIdle()

        assertEquals(0, vm.uiState.value.conversations.size)
    }

    @Test
    fun `search filters group conversations by groupName`() = runTest {
        val user = TestData.createTestUser(uid = "user-a", displayName = "Alice")
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(user))
        coEvery { pmRepository.getConversationSettings(any(), currentUserId) } returns
                Resource.Success(TestData.createTestConversationSettings(userId = currentUserId))

        val vm = createViewModel()
        advanceUntilIdle()

        val groupConv = TestData.createTestConversation(
            conversationId = "group-1",
            participantIds = listOf(currentUserId, "user-a"),
            isGroup = true,
            groupName = "Design Team"
        )
        val oneOnOneConv = TestData.createTestConversation(
            conversationId = "conv-1",
            participantIds = listOf(currentUserId, "user-a")
        )
        conversationsFlow.emit(listOf(groupConv, oneOnOneConv))
        advanceUntilIdle()

        vm.onSearchQueryChanged("Design")
        val filtered = vm.getFilteredConversations()
        assertEquals(1, filtered.size)
        assertTrue(filtered[0].isGroup)
    }

    // ===== Mark Conversation Read =====

    @Test
    fun `markConversationRead sets unread count to zero`() = runTest {
        val otherUser = TestData.createTestUser(uid = "other-user", displayName = "Other")
        coEvery { userRepository.getUsers(listOf("other-user")) } returns Resource.Success(listOf(otherUser))

        val settings = TestData.createTestConversationSettings(userId = currentUserId, unreadCount = 5)
        coEvery { pmRepository.getConversationSettings("conv-1", currentUserId) } returns Resource.Success(settings)

        val vm = createViewModel()
        advanceUntilIdle()

        val conv = TestData.createTestConversation(
            conversationId = "conv-1",
            participantIds = listOf(currentUserId, "other-user")
        )
        conversationsFlow.emit(listOf(conv))
        advanceUntilIdle()

        assertEquals(5L, vm.uiState.value.conversations[0].settings?.unreadCount)

        vm.markConversationRead("conv-1")

        val cw = vm.uiState.value.conversations.find { it.conversation.conversationId == "conv-1" }
        assertEquals(0L, cw?.settings?.unreadCount)
    }

    @Test
    fun `markConversationRead updates totalUnreadCount`() = runTest {
        val user1 = TestData.createTestUser(uid = "user-a")
        val user2 = TestData.createTestUser(uid = "user-b")
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(user1, user2))

        val settings1 = TestData.createTestConversationSettings(userId = currentUserId, unreadCount = 5)
        val settings2 = TestData.createTestConversationSettings(userId = currentUserId, unreadCount = 3)

        coEvery { pmRepository.getConversationSettings("conv-1", currentUserId) } returns Resource.Success(settings1)
        coEvery { pmRepository.getConversationSettings("conv-2", currentUserId) } returns Resource.Success(settings2)

        val vm = createViewModel()
        advanceUntilIdle()

        val conv1 = TestData.createTestConversation(
            conversationId = "conv-1",
            participantIds = listOf(currentUserId, "user-a")
        )
        val conv2 = TestData.createTestConversation(
            conversationId = "conv-2",
            participantIds = listOf(currentUserId, "user-b")
        )
        conversationsFlow.emit(listOf(conv1, conv2))
        advanceUntilIdle()

        assertEquals(8L, vm.uiState.value.totalUnreadCount)

        vm.markConversationRead("conv-1")

        assertEquals(3L, vm.uiState.value.totalUnreadCount)
    }

    // ===== Muted conversations in list but marked =====

    @Test
    fun `muted conversations appear in list with isMuted flag`() = runTest {
        val user1 = TestData.createTestUser(uid = "user-a")
        val user2 = TestData.createTestUser(uid = "user-b")
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(user1, user2))

        val mutedSettings = TestData.createTestConversationSettings(userId = currentUserId, isMuted = true)
        val normalSettings = TestData.createTestConversationSettings(userId = currentUserId, isMuted = false)

        coEvery { pmRepository.getConversationSettings("conv-muted", currentUserId) } returns Resource.Success(mutedSettings)
        coEvery { pmRepository.getConversationSettings("conv-normal", currentUserId) } returns Resource.Success(normalSettings)

        val vm = createViewModel()
        advanceUntilIdle()

        val convMuted = TestData.createTestConversation(
            conversationId = "conv-muted",
            participantIds = listOf(currentUserId, "user-a")
        )
        val convNormal = TestData.createTestConversation(
            conversationId = "conv-normal",
            participantIds = listOf(currentUserId, "user-b")
        )
        conversationsFlow.emit(listOf(convMuted, convNormal))
        advanceUntilIdle()

        assertEquals(2, vm.uiState.value.conversations.size)
        val muted = vm.uiState.value.conversations.find { it.conversation.conversationId == "conv-muted" }
        val normal = vm.uiState.value.conversations.find { it.conversation.conversationId == "conv-normal" }
        assertTrue(muted?.settings?.isMuted == true)
        assertFalse(normal?.settings?.isMuted == true)
    }

    // ===== Empty conversations list =====

    @Test
    fun `empty conversations list results in empty state`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        conversationsFlow.emit(emptyList())
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isLoading)
        assertTrue(vm.uiState.value.conversations.isEmpty())
        assertEquals(0L, vm.uiState.value.totalUnreadCount)
        assertNull(vm.uiState.value.error)
    }

    // ===== Multiple pinned conversations sort before unpinned =====

    @Test
    fun `multiple pinned conversations all appear before unpinned`() = runTest {
        val user1 = TestData.createTestUser(uid = "user-a")
        val user2 = TestData.createTestUser(uid = "user-b")
        val user3 = TestData.createTestUser(uid = "user-c")
        coEvery { userRepository.getUsers(any()) } returns Resource.Success(listOf(user1, user2, user3))

        val pinnedSettings = TestData.createTestConversationSettings(userId = currentUserId, isPinned = true)
        val normalSettings = TestData.createTestConversationSettings(userId = currentUserId, isPinned = false)

        coEvery { pmRepository.getConversationSettings("conv-pinned-1", currentUserId) } returns Resource.Success(pinnedSettings)
        coEvery { pmRepository.getConversationSettings("conv-pinned-2", currentUserId) } returns Resource.Success(pinnedSettings)
        coEvery { pmRepository.getConversationSettings("conv-normal", currentUserId) } returns Resource.Success(normalSettings)

        val vm = createViewModel()
        advanceUntilIdle()

        val convNormal = TestData.createTestConversation(
            conversationId = "conv-normal",
            participantIds = listOf(currentUserId, "user-a"),
            lastMessageAt = 3_000_000_000L // most recent but not pinned
        )
        val convPinned1 = TestData.createTestConversation(
            conversationId = "conv-pinned-1",
            participantIds = listOf(currentUserId, "user-b"),
            lastMessageAt = 1_000_000_000L
        )
        val convPinned2 = TestData.createTestConversation(
            conversationId = "conv-pinned-2",
            participantIds = listOf(currentUserId, "user-c"),
            lastMessageAt = 2_000_000_000L
        )
        conversationsFlow.emit(listOf(convNormal, convPinned1, convPinned2))
        advanceUntilIdle()

        val ids = vm.uiState.value.conversations.map { it.conversation.conversationId }
        assertEquals(3, ids.size)
        // Both pinned conversations should appear before the normal one
        assertTrue(ids.indexOf("conv-pinned-1") < ids.indexOf("conv-normal"))
        assertTrue(ids.indexOf("conv-pinned-2") < ids.indexOf("conv-normal"))
        // Among pinned, more recent lastMessageAt should come first
        assertTrue(ids.indexOf("conv-pinned-2") < ids.indexOf("conv-pinned-1"))
    }

    // ===== clearError =====

    @Test
    fun `clearError clears error`() = runTest {
        every { pmRepository.getConversations(currentUserId) } returns flow {
            throw RuntimeException("error")
        }

        val vm = ConversationListViewModel(
            pmRepository = pmRepository,
            userRepository = userRepository,
            authRepository = authRepository
        ).also { activeViewModels.add(it) }
        advanceUntilIdle()
        assertEquals("error", vm.uiState.value.error)

        vm.clearError()
        assertNull(vm.uiState.value.error)
    }
}
