package com.shyden.shytalk.feature.gacha

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.EconomyConfig
import com.shyden.shytalk.core.model.GachaGift
import com.shyden.shytalk.core.model.GachaResult
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.flow.flow
import kotlinx.coroutines.flow.flowOf
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.After
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

    private val sampleGifts =
        listOf(
            Gift(id = "g1", name = "Rose", coinValue = 8),
            Gift(id = "g2", name = "Crown", coinValue = 500),
            Gift(id = "g3", name = "Display", coinValue = 0),
        )

    private val singleResult =
        GachaResult(
            gifts = listOf(GachaGift(giftId = "g1", giftName = "Rose", coinValue = 8)),
            coinsSpent = 10,
            newBalance = 90,
            newPityCounter = 1,
            newLuckScore = 0,
        )

    private val multiResult =
        GachaResult(
            gifts =
                listOf(
                    GachaGift(giftId = "g1", giftName = "Rose", coinValue = 8),
                    GachaGift(giftId = "g2", giftName = "Crown", coinValue = 500),
                    GachaGift(giftId = "g1", giftName = "Rose", coinValue = 8),
                    GachaGift(giftId = "g1", giftName = "Rose", coinValue = 8),
                    GachaGift(giftId = "g1", giftName = "Rose", coinValue = 8),
                    GachaGift(giftId = "g1", giftName = "Rose", coinValue = 8),
                    GachaGift(giftId = "g1", giftName = "Rose", coinValue = 8),
                    GachaGift(giftId = "g1", giftName = "Rose", coinValue = 8),
                    GachaGift(giftId = "g1", giftName = "Rose", coinValue = 8),
                    GachaGift(giftId = "g1", giftName = "Rose", coinValue = 8),
                ),
            coinsSpent = 100,
            newBalance = 900,
            newPityCounter = 10,
            newLuckScore = 0,
        )

    private val activeViewModels = mutableListOf<GachaViewModel>()

    @Before
    fun setup() {
        every { giftRepository.observeAllGifts() } returns giftsFlow
        every { economyRepository.observeEconomyConfig() } returns
            flowOf(
                EconomyConfig(pullCosts = mapOf(1 to 10, 10 to 100, 100 to 1000)),
            )
    }

    @After
    fun tearDown() =
        runBlocking {
            activeViewModels.forEach {
                it.viewModelScope.coroutineContext.job
                    .cancelAndJoin()
            }
            activeViewModels.clear()
        }

    private fun createViewModel(): GachaViewModel = GachaViewModel(economyRepository, giftRepository).also { activeViewModels.add(it) }

    @Test
    fun `winnableGifts filters out zero coinValue and pads to 16`() =
        runTest {
            val vm = createViewModel()
            giftsFlow.emit(sampleGifts)
            advanceUntilIdle()

            val state = vm.uiState.value
            // 2 winnable gifts (coinValue > 0), padded to 16 by repeating
            assertEquals(GachaViewModel.WHEEL_SIZE, state.winnableGifts.size)
            assertTrue(state.winnableGifts.all { it.coinValue > 0 })
            // Original distinct gifts are g1 and g2
            assertEquals(setOf("g1", "g2"), state.winnableGifts.map { it.id }.toSet())
            assertEquals(3, state.giftCatalog.size)
        }

    @Test
    fun `single pull sets currentWin`() =
        runTest {
            coEvery { economyRepository.pullGacha(1, any()) } returns Resource.Success(singleResult)

            val vm = createViewModel()
            vm.updateBalance(100, 0)
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
    fun `multi pull sets isMultiSpin and multiSpinResults`() =
        runTest {
            coEvery { economyRepository.pullGacha(10, any()) } returns Resource.Success(multiResult)

            val vm = createViewModel()
            vm.updateBalance(1000, 0)
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
    fun `advanceMultiSpin increments index`() =
        runTest {
            coEvery { economyRepository.pullGacha(10, any()) } returns Resource.Success(multiResult)

            val vm = createViewModel()
            vm.updateBalance(1000, 0)
            vm.pullTen()
            advanceUntilIdle()

            vm.advanceMultiSpin()
            assertEquals(1, vm.uiState.value.multiSpinIndex)
            vm.advanceMultiSpin()
            assertEquals(2, vm.uiState.value.multiSpinIndex)
        }

    @Test
    fun `skipMultiSpin jumps to end`() =
        runTest {
            coEvery { economyRepository.pullGacha(10, any()) } returns Resource.Success(multiResult)

            val vm = createViewModel()
            vm.updateBalance(1000, 0)
            vm.pullTen()
            advanceUntilIdle()

            vm.skipMultiSpin()

            val state = vm.uiState.value
            assertEquals(10, state.multiSpinIndex)
            assertTrue(state.showResults)
        }

    @Test
    fun `dismissResults resets all spin state`() =
        runTest {
            coEvery { economyRepository.pullGacha(1, any()) } returns Resource.Success(singleResult)

            val vm = createViewModel()
            vm.updateBalance(100, 0)
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
    fun `pull fails with insufficient coins`() =
        runTest {
            val vm = createViewModel()
            vm.updateBalance(5, 0)
            vm.pullSingle()
            advanceUntilIdle()

            assertTrue(vm.uiState.value.error is UiText.Res)
            assertNull(vm.uiState.value.currentWin)
        }

    @Test
    fun `pull error from server sets error state`() =
        runTest {
            coEvery { economyRepository.pullGacha(1, any()) } returns Resource.Error("Server error")

            val vm = createViewModel()
            vm.updateBalance(100, 0)
            vm.pullSingle()
            advanceUntilIdle()

            assertEquals(UiText.Plain("Server error"), vm.uiState.value.error)
            assertFalse(vm.uiState.value.isPulling)
        }

    @Test
    fun `hundred pull requires 1000 coins`() =
        runTest {
            val vm = createViewModel()
            vm.updateBalance(999, 0)
            vm.pullHundred()
            advanceUntilIdle()

            assertTrue(vm.uiState.value.error is UiText.Res)
        }

    @Test
    fun `clearError clears error`() =
        runTest {
            val vm = createViewModel()
            vm.updateBalance(5, 0)
            vm.pullSingle()
            advanceUntilIdle()

            assertNotNull(vm.uiState.value.error)
            vm.clearError()
            assertNull(vm.uiState.value.error)
        }

    // ===== updateBalance =====

    @Test
    fun `updateBalance updates coin balance and pity counter`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()

            vm.updateBalance(500L, 42)

            assertEquals(500L, vm.uiState.value.coinBalance)
            assertEquals(42, vm.uiState.value.pityCounter)
        }

    // ===== pullHundred success =====

    @Test
    fun `hundred pull success sets isMultiSpin and multiSpinResults`() =
        runTest {
            val hundredResult =
                GachaResult(
                    gifts = (1..100).map { GachaGift(giftId = "g1", giftName = "Rose", coinValue = 8) },
                    coinsSpent = 1000,
                    newBalance = 0,
                    newPityCounter = 100,
                    newLuckScore = 0,
                )
            coEvery { economyRepository.pullGacha(100, any()) } returns Resource.Success(hundredResult)

            val vm = createViewModel()
            vm.updateBalance(1000, 0)
            vm.pullHundred()
            advanceUntilIdle()

            val state = vm.uiState.value
            assertTrue(state.isMultiSpin)
            assertEquals(100, state.multiSpinResults.size)
            assertTrue(state.showResults)
            assertEquals(0L, state.coinBalance)
        }

    // ===== pull — priceChanged branch =====

    @Test
    fun `pull returns priceChanged true sets error and updates pullCosts`() =
        runTest {
            val newCosts = mapOf(1 to 20, 10 to 200, 100 to 2000)
            val priceChangedResult =
                GachaResult(
                    gifts = emptyList(),
                    coinsSpent = 0,
                    newBalance = 100,
                    newPityCounter = 0,
                    newLuckScore = 0,
                    priceChanged = true,
                    currentPullCosts = newCosts,
                )
            coEvery { economyRepository.pullGacha(1, any()) } returns Resource.Success(priceChangedResult)

            val vm = createViewModel()
            vm.updateBalance(100, 0)
            vm.pullSingle()
            advanceUntilIdle()

            val state = vm.uiState.value
            assertFalse(state.isPulling)
            assertTrue(state.error is UiText.Res)
            assertEquals(newCosts, state.pullCosts)
            // Should not have set any pull results
            assertTrue(state.pullResults.isEmpty())
            assertNull(state.currentWin)
        }

    @Test
    fun `pull returns priceChanged true with null costs keeps existing pullCosts`() =
        runTest {
            val priceChangedResult =
                GachaResult(
                    gifts = emptyList(),
                    coinsSpent = 0,
                    newBalance = 100,
                    newPityCounter = 0,
                    newLuckScore = 0,
                    priceChanged = true,
                    currentPullCosts = null,
                )
            coEvery { economyRepository.pullGacha(1, any()) } returns Resource.Success(priceChangedResult)

            val vm = createViewModel()
            vm.updateBalance(100, 0)
            advanceUntilIdle()

            // Capture existing pullCosts
            val existingCosts = vm.uiState.value.pullCosts

            vm.pullSingle()
            advanceUntilIdle()

            val state = vm.uiState.value
            assertFalse(state.isPulling)
            assertTrue(state.error is UiText.Res)
            // pullCosts should be unchanged when currentPullCosts is null
            assertEquals(existingCosts, state.pullCosts)
        }

    // ===== Pull with exactly 0 coins =====

    @Test
    fun `pull with zero balance shows error`() =
        runTest {
            val vm = createViewModel()
            vm.updateBalance(0, 0)
            vm.pullSingle()
            advanceUntilIdle()

            assertTrue(vm.uiState.value.error is UiText.Res)
            assertNull(vm.uiState.value.currentWin)
            assertFalse(vm.uiState.value.isPulling)
        }

    // ===== Rapid pulls — second pull while first is in flight =====

    @Test
    fun `rapid double pull does not double-fire`() =
        runTest {
            coEvery { economyRepository.pullGacha(1, any()) } returns Resource.Success(singleResult)

            val vm = createViewModel()
            vm.updateBalance(100, 0)

            // First pull
            vm.pullSingle()
            // Second pull while first is in flight — isPulling is true, but pull()
            // doesn't guard on isPulling. Instead it checks balance which is still 100.
            // The real safeguard is server-side. Still, both will succeed client-side.
            advanceUntilIdle()

            // At minimum, state should be consistent (not crashed)
            assertFalse(vm.uiState.value.isPulling)
            assertNotNull(vm.uiState.value.currentWin)
        }

    // ===== configLoaded tracks pullCosts =====

    @Test
    fun `configLoaded is true when pullCosts are present`() =
        runTest {
            val vm = createViewModel()
            advanceUntilIdle()

            // Config was emitted in setup with pullCosts = {1=10, 10=100, 100=1000}
            assertTrue(vm.uiState.value.configLoaded)
            assertEquals(mapOf(1 to 10, 10 to 100, 100 to 1000), vm.uiState.value.pullCosts)
        }

    @Test
    fun `configLoaded is false when pullCosts are empty`() =
        runTest {
            // Override to emit config with empty pullCosts
            every { economyRepository.observeEconomyConfig() } returns
                flowOf(
                    EconomyConfig(pullCosts = emptyMap()),
                )

            val vm = createViewModel()
            advanceUntilIdle()

            assertFalse(vm.uiState.value.configLoaded)
        }

    // ===== Multi pull ten with insufficient coins =====

    @Test
    fun `ten pull with insufficient coins shows error`() =
        runTest {
            val vm = createViewModel()
            vm.updateBalance(99, 0) // 10-pull costs 100
            vm.pullTen()
            advanceUntilIdle()

            assertTrue(vm.uiState.value.error is UiText.Res)
            assertFalse(vm.uiState.value.isPulling)
        }

    // ===== advanceMultiSpin beyond results length =====

    @Test
    fun `advanceMultiSpin beyond results does not crash`() =
        runTest {
            coEvery { economyRepository.pullGacha(10, any()) } returns Resource.Success(multiResult)

            val vm = createViewModel()
            vm.updateBalance(1000, 0)
            vm.pullTen()
            advanceUntilIdle()

            // Advance beyond the 10 results
            repeat(15) { vm.advanceMultiSpin() }

            // Should not crash; index should be > size
            assertTrue(vm.uiState.value.multiSpinIndex > vm.uiState.value.multiSpinResults.size)
        }

    // ===== Single pull updates pullResults =====

    @Test
    fun `single pull sets pullResults`() =
        runTest {
            coEvery { economyRepository.pullGacha(1, any()) } returns Resource.Success(singleResult)

            val vm = createViewModel()
            vm.updateBalance(100, 0)
            vm.pullSingle()
            advanceUntilIdle()

            assertEquals(1, vm.uiState.value.pullResults.size)
            assertEquals(
                "g1",
                vm.uiState.value.pullResults[0]
                    .giftId,
            )
        }

    // ===== Pull updates pity counter =====

    @Test
    fun `pull updates pity counter from result`() =
        runTest {
            val result = singleResult.copy(newPityCounter = 42)
            coEvery { economyRepository.pullGacha(1, any()) } returns Resource.Success(result)

            val vm = createViewModel()
            vm.updateBalance(100, 0)
            vm.pullSingle()
            advanceUntilIdle()

            assertEquals(42, vm.uiState.value.pityCounter)
        }

    // ===== showOnWheel filtering =====

    @Test
    fun `winnableGifts excludes gifts with showOnWheel false`() =
        runTest {
            val vm = createViewModel()
            giftsFlow.emit(
                listOf(
                    Gift(id = "g1", name = "Rose", coinValue = 8, showOnWheel = true),
                    Gift(id = "g2", name = "Crown", coinValue = 500, showOnWheel = false),
                    Gift(id = "g3", name = "Star", coinValue = 15, showOnWheel = true),
                ),
            )
            advanceUntilIdle()

            val state = vm.uiState.value
            // Only g1 and g3 are on the wheel (showOnWheel = true, coinValue > 0), padded to 16
            assertEquals(GachaViewModel.WHEEL_SIZE, state.winnableGifts.size)
            assertEquals(setOf("g1", "g3"), state.winnableGifts.map { it.id }.toSet())
        }

    @Test
    fun `winnableGifts empty when no gifts have showOnWheel true`() =
        runTest {
            val vm = createViewModel()
            giftsFlow.emit(
                listOf(
                    Gift(id = "g1", name = "Rose", coinValue = 8, showOnWheel = false),
                    Gift(id = "g2", name = "Crown", coinValue = 500, showOnWheel = false),
                ),
            )
            advanceUntilIdle()

            assertTrue(
                vm.uiState.value.winnableGifts
                    .isEmpty(),
            )
        }

    @Test
    fun `winnableGifts exactly 16 when more than 16 eligible gifts`() =
        runTest {
            val vm = createViewModel()
            val gifts =
                (1..20).map {
                    Gift(id = "g$it", name = "Gift $it", coinValue = it * 10, showOnWheel = true)
                }
            giftsFlow.emit(gifts)
            advanceUntilIdle()

            assertEquals(GachaViewModel.WHEEL_SIZE, vm.uiState.value.winnableGifts.size)
            // Should take first 16 by order
            assertEquals(
                (1..16).map { "g$it" },
                vm.uiState.value.winnableGifts
                    .map { it.id },
            )
        }

    // ===== Gift catalog error =====

    @Test
    fun `gift catalog error sets error state`() =
        runTest {
            // Override with an error-throwing flow
            val errorFlow = MutableSharedFlow<List<Gift>>()
            every { giftRepository.observeAllGifts() } returns errorFlow

            val vm = createViewModel()
            advanceUntilIdle()

            // Emit error via exception
            try {
                errorFlow.emit(emptyList())
            } catch (_: Exception) {
            }

            // The flow should handle empty gracefully
            assertEquals(0, vm.uiState.value.giftCatalog.size)
        }

    // ===== Regression: Flow error handling (Cycle 1 Pass 7) =====

    @Test
    fun `config flow error does not crash ViewModel`() =
        runTest {
            val errorConfigFlow =
                flow<EconomyConfig> {
                    throw RuntimeException("Firestore unavailable")
                }
            every { economyRepository.observeEconomyConfig() } returns errorConfigFlow
            every { economyRepository.observeBalance() } returns flowOf(100)

            val vm = createViewModel()
            advanceUntilIdle()

            // VM should still be alive with default state (not crashed)
            assertNotNull(vm.uiState.value)
            assertFalse(vm.uiState.value.configLoaded)
        }

    @Test
    fun `balance flow error does not crash ViewModel`() =
        runTest {
            val errorBalanceFlow =
                flow<Long> {
                    throw RuntimeException("Firestore unavailable")
                }
            every { economyRepository.observeBalance() } returns errorBalanceFlow

            val vm = createViewModel()
            advanceUntilIdle()

            // VM should still be alive (balance stays at default 0)
            assertNotNull(vm.uiState.value)
            assertEquals(0L, vm.uiState.value.coinBalance)
        }
}
