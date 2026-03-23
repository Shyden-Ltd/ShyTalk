package com.shyden.shytalk.feature.daily

import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.cancelAndJoin
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
import org.junit.Rule
import org.junit.Test

@OptIn(ExperimentalCoroutinesApi::class)
class DailyRewardViewModelTest {
    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val economyRepository = mockk<EconomyRepository>(relaxed = true)
    private val authRepository = mockk<AuthRepository>(relaxed = true)

    private val activeViewModels = mutableListOf<DailyRewardViewModel>()

    @After
    fun tearDown() =
        runBlocking {
            activeViewModels.forEach {
                it.viewModelScope.coroutineContext.job
                    .cancelAndJoin()
            }
            activeViewModels.clear()
        }

    private fun createViewModel(): DailyRewardViewModel =
        DailyRewardViewModel(economyRepository, authRepository).also {
            activeViewModels.add(it)
        }

    @Test
    fun `initial state has defaults`() =
        runTest {
            val vm = createViewModel()

            val state = vm.uiState.value
            assertNull(state.reward)
            assertFalse(state.hasClaimedToday)
            assertEquals(0, state.currentStreak)
            assertFalse(state.isClaiming)
            assertFalse(state.showDialog)
            assertNull(state.error)
        }

    @Test
    fun `checkAndShowDialog shows dialog when not claimed today`() =
        runTest {
            val vm = createViewModel()
            val user =
                TestData.createTestUser(uid = "user-1").copy(
                    lastLoginRewardDate = "2020-01-01",
                    loginStreak = 5,
                )

            vm.checkAndShowDialog(user)

            val state = vm.uiState.value
            assertTrue(state.showDialog)
            assertFalse(state.hasClaimedToday)
            assertEquals(5, state.currentStreak)
        }

    @Test
    fun `checkAndShowDialog shows dialog even when already claimed today`() =
        runTest {
            val vm = createViewModel()
            // Use java.time to compute today's date in the same format as the VM
            val today =
                java.time.LocalDate
                    .now()
                    .toString()
            val user =
                TestData.createTestUser(uid = "user-1").copy(
                    lastLoginRewardDate = today,
                    loginStreak = 3,
                )

            vm.checkAndShowDialog(user)

            val state = vm.uiState.value
            assertTrue(state.showDialog) // Calendar always visible
            assertTrue(state.hasClaimedToday)
            assertEquals(3, state.currentStreak)
        }

    @Test
    fun `checkAndShowDialog sets currentStreak from user`() =
        runTest {
            val vm = createViewModel()
            val user =
                TestData.createTestUser(uid = "user-1").copy(
                    lastLoginRewardDate = null,
                    loginStreak = 14,
                )

            vm.checkAndShowDialog(user)

            assertEquals(14, vm.uiState.value.currentStreak)
        }

    @Test
    fun `claimReward success sets reward, streak, and hasClaimedToday`() =
        runTest {
            val rewardResult =
                TestData.createTestDailyRewardResult(
                    coinsAwarded = 100,
                    newStreak = 7,
                    isMilestone = true,
                    newBalance = 1000,
                )
            coEvery { economyRepository.claimDailyReward() } returns Resource.Success(rewardResult)

            val vm = createViewModel()
            vm.claimReward()
            advanceUntilIdle()

            val state = vm.uiState.value
            assertNotNull(state.reward)
            assertEquals(100, state.reward!!.coinsAwarded)
            assertEquals(7, state.currentStreak)
            assertTrue(state.hasClaimedToday)
            assertFalse(state.isClaiming)
        }

    @Test
    fun `claimReward failure sets error`() =
        runTest {
            coEvery { economyRepository.claimDailyReward() } returns Resource.Error("Already claimed today")

            val vm = createViewModel()
            vm.claimReward()
            advanceUntilIdle()

            val state = vm.uiState.value
            assertEquals("Already claimed today", state.error)
            assertFalse(state.isClaiming)
            assertNull(state.reward)
        }

    // ===== Claim when already claimed today =====

    @Test
    fun `claimReward after already claimed today returns error`() =
        runTest {
            coEvery { economyRepository.claimDailyReward() } returns Resource.Error("Already claimed today")

            val vm = createViewModel()
            val today =
                java.time.LocalDate
                    .now()
                    .toString()
            val user =
                TestData.createTestUser(uid = "user-1").copy(
                    lastLoginRewardDate = today,
                    loginStreak = 5,
                )

            vm.checkAndShowDialog(user)
            assertTrue(vm.uiState.value.hasClaimedToday)
            assertTrue(vm.uiState.value.showDialog) // Calendar always visible

            // Even if somehow claimReward is called when already claimed
            vm.claimReward()
            advanceUntilIdle()

            assertEquals("Already claimed today", vm.uiState.value.error)
            assertNull(vm.uiState.value.reward)
            assertFalse(vm.uiState.value.isClaiming)
        }

    // ===== Streak display after gap =====

    @Test
    fun `streak resets to 1 after gap in claims`() =
        runTest {
            // User had a streak of 10 but missed a day; server returns newStreak=1
            val rewardResult =
                TestData.createTestDailyRewardResult(
                    coinsAwarded = 50,
                    newStreak = 1,
                    isMilestone = false,
                    newBalance = 500,
                )
            coEvery { economyRepository.claimDailyReward() } returns Resource.Success(rewardResult)

            val vm = createViewModel()

            // User's old data shows streak of 10 and old claim date
            val user =
                TestData.createTestUser(uid = "user-1").copy(
                    lastLoginRewardDate = "2020-01-01",
                    loginStreak = 10,
                )
            vm.checkAndShowDialog(user)
            assertEquals(10, vm.uiState.value.currentStreak)

            vm.claimReward()
            advanceUntilIdle()

            // After claiming, the server response resets streak to 1
            assertEquals(1, vm.uiState.value.currentStreak)
            assertNotNull(vm.uiState.value.reward)
            assertEquals(
                50,
                vm.uiState.value.reward!!
                    .coinsAwarded,
            )
            assertTrue(vm.uiState.value.hasClaimedToday)
        }

    @Test
    fun `streak continues when claimed on consecutive days`() =
        runTest {
            val rewardResult =
                TestData.createTestDailyRewardResult(
                    coinsAwarded = 150,
                    newStreak = 8,
                    isMilestone = false,
                    newBalance = 2000,
                )
            coEvery { economyRepository.claimDailyReward() } returns Resource.Success(rewardResult)

            val vm = createViewModel()

            val yesterday =
                java.time.LocalDate
                    .now()
                    .minusDays(1)
                    .toString()
            val user =
                TestData.createTestUser(uid = "user-1").copy(
                    lastLoginRewardDate = yesterday,
                    loginStreak = 7,
                )
            vm.checkAndShowDialog(user)
            assertEquals(7, vm.uiState.value.currentStreak)
            assertTrue(vm.uiState.value.showDialog)

            vm.claimReward()
            advanceUntilIdle()

            assertEquals(8, vm.uiState.value.currentStreak)
            assertTrue(vm.uiState.value.hasClaimedToday)
        }

    @Test
    fun `dismissDialog sets showDialog false`() =
        runTest {
            val vm = createViewModel()
            val user =
                TestData.createTestUser(uid = "user-1").copy(
                    lastLoginRewardDate = "2020-01-01",
                )
            vm.checkAndShowDialog(user)
            assertTrue(vm.uiState.value.showDialog)

            vm.dismissDialog()

            assertFalse(vm.uiState.value.showDialog)
        }
}
