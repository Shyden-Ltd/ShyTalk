package com.shyden.shytalk.feature.shop

import com.shyden.shytalk.core.model.TransactionType
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.coVerify
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class TransactionHistoryViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val economyRepository = mockk<EconomyRepository>(relaxed = true)

    private val sampleTransactions = listOf(
        TestData.createTestTransaction(id = "tx-1", type = TransactionType.PURCHASE, timestamp = 3000),
        TestData.createTestTransaction(id = "tx-2", type = TransactionType.GACHA_PULL, timestamp = 2000),
        TestData.createTestTransaction(id = "tx-3", type = TransactionType.GIFT_SENT, timestamp = 1000),
        TestData.createTestTransaction(id = "tx-4", type = TransactionType.GIFT_RECEIVED, timestamp = 500),
        TestData.createTestTransaction(id = "tx-5", type = TransactionType.DAILY_REWARD, timestamp = 400),
        TestData.createTestTransaction(id = "tx-6", type = TransactionType.BEAN_REDEEM, timestamp = 300)
    )

    private fun createViewModel(): TransactionHistoryViewModel {
        return TransactionHistoryViewModel(economyRepository)
    }

    @Test
    fun `init loads all transactions with null filter`() = runTest {
        coEvery { economyRepository.getAllTransactions(null) } returns Resource.Success(sampleTransactions)

        val vm = createViewModel()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(6, state.transactions.size)
        assertFalse(state.isLoading)
        assertNull(state.selectedFilter)
        assertNull(state.error)
    }

    @Test
    fun `init failure sets error`() = runTest {
        coEvery { economyRepository.getAllTransactions(null) } returns Resource.Error("Network error")

        val vm = createViewModel()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals("Network error", state.error)
        assertFalse(state.isLoading)
        assertTrue(state.transactions.isEmpty())
    }

    @Test
    fun `setFilter Purchases uses server filter PURCHASE`() = runTest {
        coEvery { economyRepository.getAllTransactions(null) } returns Resource.Success(emptyList())
        coEvery { economyRepository.getAllTransactions("PURCHASE") } returns Resource.Success(
            listOf(sampleTransactions[0])
        )

        val vm = createViewModel()
        advanceUntilIdle()

        vm.setFilter("Purchases")
        advanceUntilIdle()

        assertEquals("Purchases", vm.uiState.value.selectedFilter)
        coVerify { economyRepository.getAllTransactions("PURCHASE") }
    }

    @Test
    fun `setFilter Gacha uses server filter GACHA_PULL`() = runTest {
        coEvery { economyRepository.getAllTransactions(null) } returns Resource.Success(emptyList())
        coEvery { economyRepository.getAllTransactions("GACHA_PULL") } returns Resource.Success(emptyList())

        val vm = createViewModel()
        advanceUntilIdle()

        vm.setFilter("Gacha")
        advanceUntilIdle()

        coVerify { economyRepository.getAllTransactions("GACHA_PULL") }
    }

    @Test
    fun `setFilter Rewards uses server filter DAILY_REWARD`() = runTest {
        coEvery { economyRepository.getAllTransactions(null) } returns Resource.Success(emptyList())
        coEvery { economyRepository.getAllTransactions("DAILY_REWARD") } returns Resource.Success(emptyList())

        val vm = createViewModel()
        advanceUntilIdle()

        vm.setFilter("Rewards")
        advanceUntilIdle()

        coVerify { economyRepository.getAllTransactions("DAILY_REWARD") }
    }

    @Test
    fun `setFilter Redemptions uses server filter BEAN_REDEEM`() = runTest {
        coEvery { economyRepository.getAllTransactions(null) } returns Resource.Success(emptyList())
        coEvery { economyRepository.getAllTransactions("BEAN_REDEEM") } returns Resource.Success(emptyList())

        val vm = createViewModel()
        advanceUntilIdle()

        vm.setFilter("Redemptions")
        advanceUntilIdle()

        coVerify { economyRepository.getAllTransactions("BEAN_REDEEM") }
    }

    @Test
    fun `setFilter Gifts loads all then filters client-side`() = runTest {
        coEvery { economyRepository.getAllTransactions(null) } returns Resource.Success(sampleTransactions)

        val vm = createViewModel()
        advanceUntilIdle()

        vm.setFilter("Gifts")
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(2, state.transactions.size)
        assertTrue(state.transactions.all {
            it.type == TransactionType.GIFT_SENT || it.type == TransactionType.GIFT_RECEIVED
        })
    }

    @Test
    fun `setFilter null reloads unfiltered`() = runTest {
        coEvery { economyRepository.getAllTransactions(null) } returns Resource.Success(sampleTransactions)

        val vm = createViewModel()
        advanceUntilIdle()

        vm.setFilter("Purchases")
        advanceUntilIdle()

        vm.setFilter(null)
        advanceUntilIdle()

        assertNull(vm.uiState.value.selectedFilter)
        assertEquals(6, vm.uiState.value.transactions.size)
    }

    @Test
    fun `Gifts filter excludes non-gift transactions`() = runTest {
        coEvery { economyRepository.getAllTransactions(null) } returns Resource.Success(
            listOf(
                TestData.createTestTransaction(id = "tx-1", type = TransactionType.PURCHASE),
                TestData.createTestTransaction(id = "tx-2", type = TransactionType.DAILY_REWARD),
                TestData.createTestTransaction(id = "tx-3", type = TransactionType.GACHA_PULL)
            )
        )

        val vm = createViewModel()
        advanceUntilIdle()

        vm.setFilter("Gifts")
        advanceUntilIdle()

        assertTrue(vm.uiState.value.transactions.isEmpty())
    }
}
