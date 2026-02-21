package com.shyden.shytalk.feature.daily

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import com.shyden.shytalk.testutil.TestData
import io.mockk.coEvery
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.runTest
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

    private fun createViewModel(): DailyRewardViewModel {
        return DailyRewardViewModel(economyRepository, authRepository)
    }

    @Test
    fun `initial state has defaults`() = runTest {
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
    fun `checkAndShowDialog shows dialog when not claimed today`() = runTest {
        val vm = createViewModel()
        val user = TestData.createTestUser(uid = "user-1").copy(
            lastLoginRewardDate = "2020-01-01",
            loginStreak = 5
        )

        vm.checkAndShowDialog(user)

        val state = vm.uiState.value
        assertTrue(state.showDialog)
        assertFalse(state.hasClaimedToday)
        assertEquals(5, state.currentStreak)
    }

    @Test
    fun `checkAndShowDialog hides dialog when already claimed today`() = runTest {
        val vm = createViewModel()
        // Use java.time to compute today's date in the same format as the VM
        val today = java.time.LocalDate.now().toString()
        val user = TestData.createTestUser(uid = "user-1").copy(
            lastLoginRewardDate = today,
            loginStreak = 3
        )

        vm.checkAndShowDialog(user)

        val state = vm.uiState.value
        assertFalse(state.showDialog)
        assertTrue(state.hasClaimedToday)
        assertEquals(3, state.currentStreak)
    }

    @Test
    fun `checkAndShowDialog sets currentStreak from user`() = runTest {
        val vm = createViewModel()
        val user = TestData.createTestUser(uid = "user-1").copy(
            lastLoginRewardDate = null,
            loginStreak = 14
        )

        vm.checkAndShowDialog(user)

        assertEquals(14, vm.uiState.value.currentStreak)
    }

    @Test
    fun `claimReward success sets reward, streak, and hasClaimedToday`() = runTest {
        val rewardResult = TestData.createTestDailyRewardResult(
            coinsAwarded = 100,
            newStreak = 7,
            isMilestone = true,
            newBalance = 1000
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
    fun `claimReward failure sets error`() = runTest {
        coEvery { economyRepository.claimDailyReward() } returns Resource.Error("Already claimed today")

        val vm = createViewModel()
        vm.claimReward()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals("Already claimed today", state.error)
        assertFalse(state.isClaiming)
        assertNull(state.reward)
    }

    @Test
    fun `dismissDialog sets showDialog false`() = runTest {
        val vm = createViewModel()
        val user = TestData.createTestUser(uid = "user-1").copy(
            lastLoginRewardDate = "2020-01-01"
        )
        vm.checkAndShowDialog(user)
        assertTrue(vm.uiState.value.showDialog)

        vm.dismissDialog()

        assertFalse(vm.uiState.value.showDialog)
    }
}
