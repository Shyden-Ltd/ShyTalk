package com.shyden.shytalk.feature.gifting

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.BackpackItem
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.MutableStateFlow
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
class GiftingViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val giftRepository = mockk<GiftRepository>(relaxed = true)
    private val economyRepository = mockk<EconomyRepository>(relaxed = true)
    private val authRepository = mockk<AuthRepository>(relaxed = true)

    private val catalogFlow = MutableSharedFlow<List<Gift>>()
    private val backpackFlow = MutableSharedFlow<List<BackpackItem>>()
    private val balanceFlow = MutableStateFlow(0L)

    private val sampleCatalog = listOf(
        Gift(id = "rose", name = "Rose", coinValue = 10),
        Gift(id = "crown", name = "Crown", coinValue = 500),
        Gift(id = "dragon", name = "Dragon", coinValue = 5000)
    )

    private val sampleBackpack = listOf(
        BackpackItem(giftId = "rose", quantity = 3),
        BackpackItem(giftId = "crown", quantity = 1)
    )

    private val activeViewModels = mutableListOf<GiftingViewModel>()

    @Before
    fun setup() {
        every { authRepository.currentUserId } returns "user-1"
        every { giftRepository.observeAllGifts() } returns catalogFlow
        every { giftRepository.observeBackpack("user-1") } returns backpackFlow
        every { economyRepository.observeBalance() } returns balanceFlow
    }

    @After
    fun tearDown() = runBlocking {
        activeViewModels.forEach { it.viewModelScope.coroutineContext.job.cancelAndJoin() }
        activeViewModels.clear()
    }

    private fun createViewModel(): GiftingViewModel {
        return GiftingViewModel(giftRepository, economyRepository, authRepository).also { activeViewModels.add(it) }
    }

    @Test
    fun `initial state has empty catalog and backpack`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertTrue(state.giftCatalog.isEmpty())
        assertTrue(state.backpackItems.isEmpty())
        assertNull(state.selectedGiftId)
        assertFalse(state.isSending)
    }

    @Test
    fun `observeData populates catalog and backpack`() = runTest {
        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(sampleBackpack)
        balanceFlow.value = 200L
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(3, state.giftCatalog.size)
        assertEquals(2, state.backpackItems.size)
        assertEquals(200L, state.coinBalance)
    }

    @Test
    fun `selectGift sets selectedGiftId`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.selectGift("rose")
        assertEquals("rose", vm.uiState.value.selectedGiftId)
    }

    @Test
    fun `selectGift with null clears selection`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.selectGift("rose")
        assertEquals("rose", vm.uiState.value.selectedGiftId)

        vm.selectGift(null)
        assertNull(vm.uiState.value.selectedGiftId)
    }

    @Test
    fun `sendGift with owned gift calls sendGift`() = runTest {
        coEvery { economyRepository.sendGift("recipient-1", "rose", 1) } returns
            Resource.Success(mapOf("giftName" to "Rose"))

        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(sampleBackpack)
        advanceUntilIdle()

        vm.sendGift("recipient-1", "rose")
        advanceUntilIdle()

        coVerify { economyRepository.sendGift("recipient-1", "rose", 1) }
        val state = vm.uiState.value
        assertFalse(state.isSending)
        assertNull(state.selectedGiftId)
        assertEquals("Rose", state.sentGiftName)
        assertEquals("rose", state.sentGiftId)
    }

    @Test
    fun `sendGift with unowned gift calls sendGiftDirect`() = runTest {
        coEvery { economyRepository.sendGiftDirect("recipient-1", "dragon", 1) } returns
            Resource.Success(mapOf("giftName" to "Dragon"))

        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(sampleBackpack) // backpack has rose and crown, NOT dragon
        advanceUntilIdle()

        vm.sendGift("recipient-1", "dragon")
        advanceUntilIdle()

        coVerify { economyRepository.sendGiftDirect("recipient-1", "dragon", 1) }
        val state = vm.uiState.value
        assertEquals("Dragon", state.sentGiftName)
        assertEquals("dragon", state.sentGiftId)
    }

    @Test
    fun `sendGift error sets error state`() = runTest {
        coEvery { economyRepository.sendGift("recipient-1", "rose", 1) } returns
            Resource.Error("Network error")

        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(sampleBackpack)
        advanceUntilIdle()

        vm.sendGift("recipient-1", "rose")
        advanceUntilIdle()

        val state = vm.uiState.value
        assertFalse(state.isSending)
        assertEquals("Network error", state.error)
    }

    @Test
    fun `sendGift sets isSending during send`() = runTest {
        coEvery { economyRepository.sendGift(any(), any(), any()) } returns
            Resource.Success(mapOf("giftName" to "Rose"))

        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(sampleBackpack)
        advanceUntilIdle()

        vm.sendGift("recipient-1", "rose")
        // isSending is set immediately before the coroutine completes
        advanceUntilIdle()

        assertFalse(vm.uiState.value.isSending)
    }

    @Test
    fun `clearSentGift clears sentGiftName and sentGiftId`() = runTest {
        coEvery { economyRepository.sendGift("recipient-1", "rose", 1) } returns
            Resource.Success(mapOf("giftName" to "Rose"))

        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(sampleBackpack)
        advanceUntilIdle()

        vm.sendGift("recipient-1", "rose")
        advanceUntilIdle()

        assertEquals("Rose", vm.uiState.value.sentGiftName)
        assertEquals("rose", vm.uiState.value.sentGiftId)

        vm.clearSentGift()

        assertNull(vm.uiState.value.sentGiftName)
        assertNull(vm.uiState.value.sentGiftId)
    }

    @Test
    fun `clearError clears error`() = runTest {
        coEvery { economyRepository.sendGift(any(), any(), any()) } returns
            Resource.Error("Something went wrong")

        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(sampleBackpack)
        advanceUntilIdle()

        vm.sendGift("recipient-1", "rose")
        advanceUntilIdle()

        assertEquals("Something went wrong", vm.uiState.value.error)

        vm.clearError()

        assertNull(vm.uiState.value.error)
    }

    @Test
    fun `no userId skips data observation`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertTrue(state.giftCatalog.isEmpty())
        assertTrue(state.backpackItems.isEmpty())
    }

    @Test
    fun `sendGift with zero quantity item calls sendGiftDirect`() = runTest {
        val backpackWithZero = listOf(
            BackpackItem(giftId = "rose", quantity = 0)
        )
        coEvery { economyRepository.sendGiftDirect("recipient-1", "rose", 1) } returns
            Resource.Success(mapOf("giftName" to "Rose"))

        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(backpackWithZero)
        advanceUntilIdle()

        vm.sendGift("recipient-1", "rose")
        advanceUntilIdle()

        coVerify { economyRepository.sendGiftDirect("recipient-1", "rose", 1) }
    }

    @Test
    fun `sendGift success response without giftName defaults to empty string`() = runTest {
        coEvery { economyRepository.sendGift("recipient-1", "rose", 1) } returns
            Resource.Success(mapOf("otherField" to "value"))

        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(sampleBackpack)
        advanceUntilIdle()

        vm.sendGift("recipient-1", "rose")
        advanceUntilIdle()

        assertEquals("", vm.uiState.value.sentGiftName)
    }

    // --- New tests for multi-recipient, quantity, expired items ---

    @Test
    fun `setQuantity updates selectedQuantity`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.setQuantity(10)
        assertEquals(10, vm.uiState.value.selectedQuantity)
    }

    @Test
    fun `setQuantity clamps to at least 1`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.setQuantity(0)
        assertEquals(1, vm.uiState.value.selectedQuantity)
    }

    @Test
    fun `toggleRecipient adds and removes`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.toggleRecipient("user-2")
        assertTrue("user-2" in vm.uiState.value.selectedRecipientIds)

        vm.toggleRecipient("user-2")
        assertFalse("user-2" in vm.uiState.value.selectedRecipientIds)
    }

    @Test
    fun `selectAllRecipients excludes current user`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.selectAllRecipients(setOf("user-1", "user-2", "user-3"))

        val selected = vm.uiState.value.selectedRecipientIds
        assertFalse("user-1" in selected) // self excluded
        assertTrue("user-2" in selected)
        assertTrue("user-3" in selected)
        assertTrue(vm.uiState.value.isAllSelected)
    }

    @Test
    fun `deselectAllRecipients clears selection`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.toggleRecipient("user-2")
        vm.toggleRecipient("user-3")
        vm.deselectAllRecipients()

        assertTrue(vm.uiState.value.selectedRecipientIds.isEmpty())
        assertFalse(vm.uiState.value.isAllSelected)
    }

    @Test
    fun `confirmSend with multiple recipients calls sendGiftBatch`() = runTest {
        coEvery {
            economyRepository.sendGiftBatch(any(), any(), any(), any())
        } returns Resource.Success(mapOf("giftName" to "Rose"))

        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(sampleBackpack)
        advanceUntilIdle()

        vm.setActiveTab(1) // backpack tab
        vm.selectGift("rose")
        vm.setQuantity(2)
        vm.toggleRecipient("user-2")
        vm.toggleRecipient("user-3")
        vm.confirmSend()
        advanceUntilIdle()

        coVerify {
            economyRepository.sendGiftBatch(
                match { it.containsAll(listOf("user-2", "user-3")) },
                "rose",
                2,
                true
            )
        }
    }

    @Test
    fun `confirmSend with single recipient on gifts tab calls sendGiftDirect`() = runTest {
        coEvery {
            economyRepository.sendGiftDirect("user-2", "dragon", 1)
        } returns Resource.Success(mapOf("giftName" to "Dragon"))

        balanceFlow.value = 10000L
        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(sampleBackpack)
        advanceUntilIdle()

        vm.setActiveTab(0) // gifts tab
        vm.selectGift("dragon")
        vm.toggleRecipient("user-2")
        vm.confirmSend()
        advanceUntilIdle()

        coVerify { economyRepository.sendGiftDirect("user-2", "dragon", 1) }
    }

    @Test
    fun `confirmSend on gifts tab with insufficient coins sets navigateToWallet`() = runTest {
        balanceFlow.value = 100L
        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(sampleBackpack)
        advanceUntilIdle()

        vm.setActiveTab(0)
        vm.selectGift("dragon") // costs 5000
        vm.toggleRecipient("user-2")
        vm.requestSend()
        vm.confirmSend()
        advanceUntilIdle()

        assertTrue(vm.uiState.value.navigateToWallet)
        assertFalse(vm.uiState.value.isSending)
        assertFalse(vm.uiState.value.showConfirmDialog)

        vm.clearNavigateToWallet()
        assertFalse(vm.uiState.value.navigateToWallet)
    }

    @Test
    fun `expired items filtered from backpack`() = runTest {
        val backpackWithExpired = listOf(
            BackpackItem(giftId = "rose", quantity = 3, expiresAt = 0), // permanent
            BackpackItem(giftId = "crown", quantity = 1, expiresAt = 1) // expired (past timestamp)
        )

        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(backpackWithExpired)
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(1, state.backpackItems.size)
        assertEquals("rose", state.backpackItems[0].giftId)
    }

    @Test
    fun `requestSend shows confirm dialog`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.selectGift("rose")
        vm.toggleRecipient("user-2")
        vm.requestSend()

        assertTrue(vm.uiState.value.showConfirmDialog)
    }

    @Test
    fun `requestSend without selection does nothing`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.requestSend()

        assertFalse(vm.uiState.value.showConfirmDialog)
    }

    @Test
    fun `dismissConfirmDialog hides dialog`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.selectGift("rose")
        vm.toggleRecipient("user-2")
        vm.requestSend()
        assertTrue(vm.uiState.value.showConfirmDialog)

        vm.dismissConfirmDialog()
        assertFalse(vm.uiState.value.showConfirmDialog)
    }

    @Test
    fun `confirmSend resets quantity and gift selection but keeps recipients`() = runTest {
        coEvery { economyRepository.sendGift("user-2", "rose", 5) } returns
            Resource.Success(mapOf("giftName" to "Rose"))

        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(sampleBackpack)
        advanceUntilIdle()

        vm.setActiveTab(1) // backpack tab
        vm.selectGift("rose")
        vm.setQuantity(5)
        vm.toggleRecipient("user-2")
        vm.confirmSend()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertNull(state.selectedGiftId)
        assertEquals(1, state.selectedQuantity)
        assertTrue("user-2" in state.selectedRecipientIds)
    }

    // --- Send All Backpack tests ---

    @Test
    fun `requestSendAll shows confirm dialog`() = runTest {
        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(sampleBackpack)
        advanceUntilIdle()

        vm.requestSendAll("user-2")

        val state = vm.uiState.value
        assertTrue(state.showSendAllConfirm)
        assertEquals("user-2", state.sendAllRecipientId)
    }

    @Test
    fun `requestSendAll with empty backpack does nothing`() = runTest {
        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(emptyList())
        advanceUntilIdle()

        vm.requestSendAll("user-2")

        assertFalse(vm.uiState.value.showSendAllConfirm)
    }

    @Test
    fun `dismissSendAllConfirm hides dialog`() = runTest {
        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(sampleBackpack)
        advanceUntilIdle()

        vm.requestSendAll("user-2")
        assertTrue(vm.uiState.value.showSendAllConfirm)

        vm.dismissSendAllConfirm()
        assertFalse(vm.uiState.value.showSendAllConfirm)
        assertNull(vm.uiState.value.sendAllRecipientId)
    }

    @Test
    fun `confirmSendAll calls sendEntireBackpack`() = runTest {
        coEvery { economyRepository.sendEntireBackpack("user-2") } returns
            Resource.Success(mapOf("totalItemsSent" to 4))

        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(sampleBackpack)
        advanceUntilIdle()

        vm.requestSendAll("user-2")
        vm.confirmSendAll()
        advanceUntilIdle()

        coVerify { economyRepository.sendEntireBackpack("user-2") }
        val state = vm.uiState.value
        assertFalse(state.isSending)
        assertFalse(state.showSendAllConfirm)
        assertEquals("entire backpack (4 items)", state.sentGiftName)
    }

    // --- toggleQuantityPicker, setActiveTab, requestSend edge cases ---

    @Test
    fun `toggleQuantityPicker toggles showQuantityPicker`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        assertFalse(vm.uiState.value.showQuantityPicker)

        vm.toggleQuantityPicker()
        assertTrue(vm.uiState.value.showQuantityPicker)

        vm.toggleQuantityPicker()
        assertFalse(vm.uiState.value.showQuantityPicker)
    }

    @Test
    fun `setActiveTab changes tab and resets selection`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.selectGift("rose")
        vm.setQuantity(5)
        assertEquals("rose", vm.uiState.value.selectedGiftId)
        assertEquals(5, vm.uiState.value.selectedQuantity)

        vm.setActiveTab(1)

        assertEquals(1, vm.uiState.value.activeTab)
        assertNull(vm.uiState.value.selectedGiftId)
        assertEquals(1, vm.uiState.value.selectedQuantity)
    }

    @Test
    fun `requestSend with no recipients does nothing`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.selectGift("rose") // gift selected but no recipients
        vm.requestSend()

        assertFalse(vm.uiState.value.showConfirmDialog)
    }

    @Test
    fun `requestSend with no gift selected does nothing`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.toggleRecipient("user-2") // recipient selected but no gift
        vm.requestSend()

        assertFalse(vm.uiState.value.showConfirmDialog)
    }

    @Test
    fun `confirmSendAll error sets error state`() = runTest {
        coEvery { economyRepository.sendEntireBackpack("user-2") } returns
            Resource.Error("Backpack is empty")

        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        backpackFlow.emit(sampleBackpack)
        advanceUntilIdle()

        vm.requestSendAll("user-2")
        vm.confirmSendAll()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertFalse(state.isSending)
        assertEquals("Backpack is empty", state.error)
    }

    // --- activateTrial tests ---

    @Test
    fun `activateTrial - success updates state with success message`() = runTest {
        coEvery { economyRepository.activateSuperShyTrial() } returns
            Resource.Success(mapOf("status" to "activated"))

        val vm = createViewModel()
        advanceUntilIdle()

        vm.activateTrial()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertFalse(state.isSending)
        assertNull(state.selectedGiftId)
        assertEquals("Super Shy Trial activated!", state.sentGiftName)
        assertNull(state.error)
    }

    @Test
    fun `activateTrial - error updates state with error message`() = runTest {
        coEvery { economyRepository.activateSuperShyTrial() } returns Resource.Error("Already active")

        val vm = createViewModel()
        advanceUntilIdle()

        vm.activateTrial()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertFalse(state.isSending)
        assertEquals("Already active", state.error)
    }

    @Test
    fun `activateTrial - sets isSending true while in progress`() = runTest {
        coEvery { economyRepository.activateSuperShyTrial() } returns
            Resource.Success(mapOf("status" to "activated"))

        val vm = createViewModel()
        advanceUntilIdle()

        vm.activateTrial()
        // isSending is set synchronously before the coroutine completes
        advanceUntilIdle()

        // After completion, isSending should be false again
        assertFalse(vm.uiState.value.isSending)
    }
}
