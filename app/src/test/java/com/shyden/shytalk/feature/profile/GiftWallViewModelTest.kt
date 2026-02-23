package com.shyden.shytalk.feature.profile

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.GiftRankEntry
import com.shyden.shytalk.core.model.GiftSender
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
import kotlinx.coroutines.job
import kotlinx.coroutines.runBlocking
import kotlinx.coroutines.flow.MutableSharedFlow
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

    private val activeViewModels = mutableListOf<GiftWallViewModel>()

    @Before
    fun setup() {
        every { giftRepository.observeAllGifts() } returns catalogFlow
        every { giftRepository.observeGiftWall("target-user") } returns wallFlow
    }

    @After
    fun tearDown() = runBlocking {
        activeViewModels.forEach { it.viewModelScope.coroutineContext.job.cancelAndJoin() }
        activeViewModels.clear()
    }

    private fun createViewModel(): GiftWallViewModel {
        return GiftWallViewModel("target-user", giftRepository)
            .also { activeViewModels.add(it) }
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
        every { giftRepository.observeAllGifts() } returns MutableSharedFlow<List<com.shyden.shytalk.core.model.Gift>>().also {
            // Return a flow that throws
        }
        // We use a flow that errors
        val errorCatalogFlow = kotlinx.coroutines.flow.flow<List<com.shyden.shytalk.core.model.Gift>> {
            throw RuntimeException("Connection lost")
        }
        every { giftRepository.observeAllGifts() } returns errorCatalogFlow

        val vm = createViewModel()
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

    @Test
    fun `selectGift loads sender details and ranking for the selected gift`() = runTest {
        val senders = listOf(
            GiftSender(userId = "s1", count = 10),
            GiftSender(userId = "s2", count = 7),
            GiftSender(userId = "s3", count = 2)
        )
        val ranking = listOf(
            GiftRankEntry(userId = "u1", count = 200, displayName = "First"),
            GiftRankEntry(userId = "u2", count = 150, displayName = "Second")
        )
        coEvery { giftRepository.getGiftWallSenders("target-user", "g2") } returns senders
        coEvery { giftRepository.getGiftRanking("g2") } returns ranking

        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        wallFlow.emit(sampleWall)
        advanceUntilIdle()

        vm.selectGift("g2")
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals("g2", state.selectedGiftId)
        assertEquals(3, state.senders.size)
        assertEquals("s1", state.senders[0].userId)
        assertEquals(10, state.senders[0].count)
        assertEquals(2, state.ranking.size)
        assertEquals("First", state.ranking[0].displayName)
        assertFalse(state.isLoadingDetails)
    }

    @Test
    fun `selectGift with nonexistent giftId still sets selectedGiftId and calls repository`() = runTest {
        coEvery { giftRepository.getGiftWallSenders("target-user", "nonexistent") } returns emptyList()
        coEvery { giftRepository.getGiftRanking("nonexistent") } returns emptyList()

        val vm = createViewModel()
        vm.selectGift("nonexistent")
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals("nonexistent", state.selectedGiftId)
        assertTrue(state.senders.isEmpty())
        assertTrue(state.ranking.isEmpty())
        assertFalse(state.isLoadingDetails)
    }

    @Test
    fun `dismissDetails clears selectedGiftId senders and ranking after selection`() = runTest {
        coEvery { giftRepository.getGiftWallSenders("target-user", "g1") } returns listOf(
            GiftSender("s1", 5), GiftSender("s2", 3)
        )
        coEvery { giftRepository.getGiftRanking("g1") } returns listOf(
            GiftRankEntry("u1", 10, "User One"),
            GiftRankEntry("u2", 8, "User Two")
        )

        val vm = createViewModel()
        vm.selectGift("g1")
        advanceUntilIdle()

        assertEquals("g1", vm.uiState.value.selectedGiftId)
        assertEquals(2, vm.uiState.value.senders.size)
        assertEquals(2, vm.uiState.value.ranking.size)

        vm.dismissDetails()

        val state = vm.uiState.value
        assertNull(state.selectedGiftId)
        assertTrue(state.senders.isEmpty())
        assertTrue(state.ranking.isEmpty())
    }

    @Test
    fun `empty gift catalog shows empty grid`() = runTest {
        val vm = createViewModel()
        catalogFlow.emit(emptyList())
        wallFlow.emit(emptyList())
        advanceUntilIdle()

        val state = vm.uiState.value
        assertTrue(state.giftCatalog.isEmpty())
        assertTrue(state.wallEntries.isEmpty())
        assertNull(state.error)
    }

    @Test
    fun `wall entries with zero receivedCount are present in state`() = runTest {
        val wallWithUnlit = listOf(
            TestData.createTestGiftWallEntry(giftId = "g1", receivedCount = 10),
            TestData.createTestGiftWallEntry(giftId = "g2", receivedCount = 0)
        )

        val vm = createViewModel()
        catalogFlow.emit(sampleCatalog)
        wallFlow.emit(wallWithUnlit)
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(2, state.wallEntries.size)
        val unlitEntry = state.wallEntries.find { it.giftId == "g2" }
        assertNotNull(unlitEntry)
        assertEquals(0, unlitEntry!!.receivedCount)
    }
}
