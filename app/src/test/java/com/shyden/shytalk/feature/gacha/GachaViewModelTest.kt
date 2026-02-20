package com.shyden.shytalk.feature.gacha

import com.shyden.shytalk.core.model.GachaGift
import com.shyden.shytalk.core.model.GachaResult
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.GiftBracket
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class GachaViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val economyRepository = mockk<EconomyRepository>(relaxed = true)
    private val giftRepository = mockk<GiftRepository>(relaxed = true)

    private val giftsFlow = MutableSharedFlow<List<Gift>>()

    private val sampleGifts = listOf(
        Gift(id = "g1", name = "Rose", baseDropRate = 40.0, bracket = GiftBracket.COMMON),
        Gift(id = "g2", name = "Crown", baseDropRate = 5.0, bracket = GiftBracket.RARE),
        Gift(id = "g3", name = "Display", baseDropRate = 0.0, bracket = GiftBracket.EPIC)
    )

    private val singleResult = GachaResult(
        gifts = listOf(GachaGift(giftId = "g1", giftName = "Rose", bracket = GiftBracket.COMMON)),
        coinsSpent = 10,
        newBalance = 90,
        newPityCounter = 1,
        newLuckScore = 0
    )

    private val multiResult = GachaResult(
        gifts = listOf(
            GachaGift(giftId = "g1", giftName = "Rose", bracket = GiftBracket.COMMON),
            GachaGift(giftId = "g2", giftName = "Crown", bracket = GiftBracket.RARE),
            GachaGift(giftId = "g1", giftName = "Rose", bracket = GiftBracket.COMMON),
            GachaGift(giftId = "g1", giftName = "Rose", bracket = GiftBracket.COMMON),
            GachaGift(giftId = "g1", giftName = "Rose", bracket = GiftBracket.COMMON),
            GachaGift(giftId = "g1", giftName = "Rose", bracket = GiftBracket.COMMON),
            GachaGift(giftId = "g1", giftName = "Rose", bracket = GiftBracket.COMMON),
            GachaGift(giftId = "g1", giftName = "Rose", bracket = GiftBracket.COMMON),
            GachaGift(giftId = "g1", giftName = "Rose", bracket = GiftBracket.COMMON),
            GachaGift(giftId = "g1", giftName = "Rose", bracket = GiftBracket.COMMON)
        ),
        coinsSpent = 100,
        newBalance = 900,
        newPityCounter = 10,
        newLuckScore = 0
    )

    @Before
    fun setup() {
        every { giftRepository.observeGiftCatalog() } returns giftsFlow
    }

    private fun createViewModel(): GachaViewModel {
        return GachaViewModel(economyRepository, giftRepository)
    }

    @Test
    fun `winnableGifts filters out zero drop rate`() = runTest {
        val vm = createViewModel()
        giftsFlow.emit(sampleGifts)
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(2, state.winnableGifts.size)
        assertTrue(state.winnableGifts.all { it.baseDropRate > 0 })
        assertEquals(3, state.giftCatalog.size)
    }

    @Test
    fun `single pull sets currentWin`() = runTest {
        coEvery { economyRepository.pullGacha(1) } returns Resource.Success(singleResult)

        val vm = createViewModel()
        vm.updateBalance(100, 0, 0)
        vm.pullSingle()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertNotNull(state.currentWin)
        assertEquals("g1", state.currentWin?.giftId)
        assertFalse(state.isMultiSpin)
        assertFalse(state.showResults)
        assertEquals(90L, state.coinBalance)
    }

    @Test
    fun `multi pull sets isMultiSpin and multiSpinResults`() = runTest {
        coEvery { economyRepository.pullGacha(10) } returns Resource.Success(multiResult)

        val vm = createViewModel()
        vm.updateBalance(1000, 0, 0)
        vm.pullTen()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertTrue(state.isMultiSpin)
        assertEquals(10, state.multiSpinResults.size)
        assertEquals(0, state.multiSpinIndex)
        assertTrue(state.showResults)
        assertEquals(900L, state.coinBalance)
    }

    @Test
    fun `advanceMultiSpin increments index`() = runTest {
        coEvery { economyRepository.pullGacha(10) } returns Resource.Success(multiResult)

        val vm = createViewModel()
        vm.updateBalance(1000, 0, 0)
        vm.pullTen()
        advanceUntilIdle()

        vm.advanceMultiSpin()
        assertEquals(1, vm.uiState.value.multiSpinIndex)
        vm.advanceMultiSpin()
        assertEquals(2, vm.uiState.value.multiSpinIndex)
    }

    @Test
    fun `skipMultiSpin jumps to end`() = runTest {
        coEvery { economyRepository.pullGacha(10) } returns Resource.Success(multiResult)

        val vm = createViewModel()
        vm.updateBalance(1000, 0, 0)
        vm.pullTen()
        advanceUntilIdle()

        vm.skipMultiSpin()

        val state = vm.uiState.value
        assertEquals(10, state.multiSpinIndex)
        assertTrue(state.showResults)
    }

    @Test
    fun `dismissResults resets all spin state`() = runTest {
        coEvery { economyRepository.pullGacha(1) } returns Resource.Success(singleResult)

        val vm = createViewModel()
        vm.updateBalance(100, 0, 0)
        vm.pullSingle()
        advanceUntilIdle()

        vm.dismissResults()

        val state = vm.uiState.value
        assertNull(state.currentWin)
        assertFalse(state.isMultiSpin)
        assertTrue(state.multiSpinResults.isEmpty())
        assertEquals(0, state.multiSpinIndex)
        assertFalse(state.showResults)
        assertTrue(state.pullResults.isEmpty())
    }

    @Test
    fun `pull fails with insufficient coins`() = runTest {
        val vm = createViewModel()
        vm.updateBalance(5, 0, 0)
        vm.pullSingle()
        advanceUntilIdle()

        assertEquals("Not enough coins", vm.uiState.value.error)
        assertNull(vm.uiState.value.currentWin)
    }

    @Test
    fun `pull error from server sets error state`() = runTest {
        coEvery { economyRepository.pullGacha(1) } returns Resource.Error("Server error")

        val vm = createViewModel()
        vm.updateBalance(100, 0, 0)
        vm.pullSingle()
        advanceUntilIdle()

        assertEquals("Server error", vm.uiState.value.error)
        assertFalse(vm.uiState.value.isPulling)
    }

    @Test
    fun `hundred pull requires 1000 coins`() = runTest {
        val vm = createViewModel()
        vm.updateBalance(999, 0, 0)
        vm.pullHundred()
        advanceUntilIdle()

        assertEquals("Not enough coins", vm.uiState.value.error)
    }

    @Test
    fun `clearError clears error`() = runTest {
        val vm = createViewModel()
        vm.updateBalance(5, 0, 0)
        vm.pullSingle()
        advanceUntilIdle()

        assertNotNull(vm.uiState.value.error)
        vm.clearError()
        assertNull(vm.uiState.value.error)
    }
}
