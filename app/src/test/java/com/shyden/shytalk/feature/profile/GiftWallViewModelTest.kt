package com.shyden.shytalk.feature.profile

import com.shyden.shytalk.core.model.GiftRankEntry
import com.shyden.shytalk.core.model.GiftSender
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.flow.MutableSharedFlow
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class GiftWallViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val giftRepository = mockk<GiftRepository>(relaxed = true)

    private val catalogFlow = MutableSharedFlow<List<com.shyden.shytalk.core.model.Gift>>()
    private val wallFlow = MutableSharedFlow<List<com.shyden.shytalk.core.model.GiftWallEntry>>()

    private val sampleCatalog = listOf(
        TestData.createTestGift(id = "g1", name = "Rose"),
        TestData.createTestGift(id = "g2", name = "Crown", coinValue = 500)
    )

    private val sampleWall = listOf(
        TestData.createTestGiftWallEntry(giftId = "g1", receivedCount = 10),
        TestData.createTestGiftWallEntry(giftId = "g2", receivedCount = 3)
    )

    @Before
    fun setup() {
        every { giftRepository.observeGiftCatalog() } returns catalogFlow
        every { giftRepository.observeGiftWall("target-user") } returns wallFlow
    }

    private fun createViewModel(): GiftWallViewModel {
        return GiftWallViewModel("target-user", giftRepository)
    }

    @Test
    fun `observeData populates catalog and wall entries`() = runTest {
        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        wallFlow.emit(sampleWall)
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(2, state.giftCatalog.size)
        assertEquals(2, state.wallEntries.size)
        assertNull(state.error)
    }

    @Test
    fun `observeData error sets error message`() = runTest {
        every { giftRepository.observeGiftCatalog() } returns MutableSharedFlow<List<com.shyden.shytalk.core.model.Gift>>().also {
            // Return a flow that throws
        }
        // We use a flow that errors
        val errorCatalogFlow = kotlinx.coroutines.flow.flow<List<com.shyden.shytalk.core.model.Gift>> {
            throw RuntimeException("Connection lost")
        }
        every { giftRepository.observeGiftCatalog() } returns errorCatalogFlow

        val vm = GiftWallViewModel("target-user", giftRepository)
        advanceUntilIdle()

        assertEquals("Connection lost", vm.uiState.value.error)
    }

    @Test
    fun `selectGift sets selectedGiftId and loads senders and ranking`() = runTest {
        val senders = listOf(
            GiftSender(userId = "s1", count = 5),
            GiftSender(userId = "s2", count = 3)
        )
        val ranking = listOf(
            GiftRankEntry(userId = "u1", count = 100, displayName = "Top User")
        )
        coEvery { giftRepository.getGiftWallSenders("target-user", "g1") } returns senders
        coEvery { giftRepository.getGiftRanking("g1") } returns ranking

        val vm = createViewModel()
        vm.selectGift("g1")
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals("g1", state.selectedGiftId)
        assertEquals(2, state.senders.size)
        assertEquals(1, state.ranking.size)
        assertFalse(state.isLoadingDetails)
    }

    @Test
    fun `selectGift error sets error`() = runTest {
        coEvery { giftRepository.getGiftWallSenders("target-user", "g1") } throws RuntimeException("Failed")

        val vm = createViewModel()
        vm.selectGift("g1")
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals("Failed", state.error)
        assertFalse(state.isLoadingDetails)
    }

    @Test
    fun `dismissDetails clears selection, senders, and ranking`() = runTest {
        coEvery { giftRepository.getGiftWallSenders("target-user", "g1") } returns listOf(
            GiftSender("s1", 5)
        )
        coEvery { giftRepository.getGiftRanking("g1") } returns listOf(
            GiftRankEntry("u1", 10, "User")
        )

        val vm = createViewModel()
        vm.selectGift("g1")
        advanceUntilIdle()

        vm.dismissDetails()

        val state = vm.uiState.value
        assertNull(state.selectedGiftId)
        assertTrue(state.senders.isEmpty())
        assertTrue(state.ranking.isEmpty())
    }

    @Test
    fun `catalog updates reactively on new emissions`() = runTest {
        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        wallFlow.emit(sampleWall)
        advanceUntilIdle()
        assertEquals(2, vm.uiState.value.giftCatalog.size)

        val updatedCatalog = sampleCatalog + TestData.createTestGift(id = "g3", name = "Star")
        catalogFlow.emit(updatedCatalog)
        wallFlow.emit(sampleWall)
        advanceUntilIdle()

        assertEquals(3, vm.uiState.value.giftCatalog.size)
    }

    @Test
    fun `wall entries update reactively`() = runTest {
        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        wallFlow.emit(sampleWall)
        advanceUntilIdle()
        assertEquals(2, vm.uiState.value.wallEntries.size)

        val updatedWall = sampleWall + TestData.createTestGiftWallEntry(giftId = "g3", receivedCount = 1)
        catalogFlow.emit(sampleCatalog)
        wallFlow.emit(updatedWall)
        advanceUntilIdle()

        assertEquals(3, vm.uiState.value.wallEntries.size)
    }
}
