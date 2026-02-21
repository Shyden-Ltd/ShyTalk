package com.shyden.shytalk.feature.shop

import com.shyden.shytalk.core.model.CoinPackage
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.testutil.MainDispatcherRule
import io.mockk.coEvery
import io.mockk.every
import io.mockk.mockk
import kotlinx.coroutines.ExperimentalCoroutinesApi
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
class WalletViewModelTest {

    @get:Rule
    val mainDispatcherRule = MainDispatcherRule()

    private val economyRepository = mockk<EconomyRepository>(relaxed = true)
    private val userRepository = mockk<UserRepository>(relaxed = true)
    private val authRepository = mockk<AuthRepository>(relaxed = true)

    private val samplePackages = listOf(
        CoinPackage(id = "p1", productId = "coins_100", coins = 100, bonusCoins = 0, displayPrice = "$0.99"),
        CoinPackage(id = "p2", productId = "coins_500", coins = 500, bonusCoins = 50, displayPrice = "$4.99")
    )

    private val sampleUser = User(
        uid = "u1",
        displayName = "Alice",
        shyCoins = 250,
        shyBeans = 1000,
        isSuperShy = true,
        superShyTier = "gold",
        superShyExpiry = 9999999999L
    )

    @Before
    fun setup() {
        every { authRepository.currentUserId } returns "u1"
        coEvery { economyRepository.getCoinPackages() } returns Resource.Success(samplePackages)
        coEvery { userRepository.getUser("u1") } returns Resource.Success(sampleUser)
    }

    private fun createViewModel(): WalletViewModel {
        return WalletViewModel(economyRepository, userRepository, authRepository)
    }

    @Test
    fun `init loads packages and user balance`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        val state = vm.uiState.value
        assertEquals(2, state.coinPackages.size)
        assertEquals(250L, state.coinBalance)
        assertEquals(1000L, state.beanBalance)
        assertTrue(state.isSuperShy)
        assertEquals("gold", state.superShyTier)
        assertFalse(state.isLoading)
    }

    @Test
    fun `init sets error when packages fail`() = runTest {
        coEvery { economyRepository.getCoinPackages() } returns Resource.Error("Network error")

        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals("Network error", vm.uiState.value.error)
    }

    @Test
    fun `init sets error when user fetch fails`() = runTest {
        coEvery { userRepository.getUser("u1") } returns Resource.Error("User not found")

        val vm = createViewModel()
        advanceUntilIdle()

        assertEquals("User not found", vm.uiState.value.error)
        assertFalse(vm.uiState.value.isLoading)
    }

    @Test
    fun `init with null userId does not crash`() = runTest {
        every { authRepository.currentUserId } returns null

        val vm = createViewModel()
        advanceUntilIdle()

        // Should still load packages but not user data
        assertEquals(2, vm.uiState.value.coinPackages.size)
        assertEquals(0L, vm.uiState.value.coinBalance)
    }

    @Test
    fun `testPurchaseCoins adds coins on success`() = runTest {
        coEvery { economyRepository.addTestCoins(500) } returns Resource.Success(emptyMap())

        val vm = createViewModel()
        advanceUntilIdle()

        vm.testPurchaseCoins(500)
        advanceUntilIdle()

        assertNotNull(vm.uiState.value.successMessage)
        assertTrue(vm.uiState.value.successMessage!!.contains("500"))
        assertFalse(vm.uiState.value.isPurchasing)
    }

    @Test
    fun `testPurchaseCoins sets error on failure`() = runTest {
        coEvery { economyRepository.addTestCoins(500) } returns Resource.Error("Server error")

        val vm = createViewModel()
        advanceUntilIdle()

        vm.testPurchaseCoins(500)
        advanceUntilIdle()

        assertEquals("Server error", vm.uiState.value.error)
        assertFalse(vm.uiState.value.isPurchasing)
    }

    @Test
    fun `redeemBeans with insufficient beans sets error`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.redeemBeans(5000) // balance is 1000
        advanceUntilIdle()

        assertEquals("Not enough beans", vm.uiState.value.error)
    }

    @Test
    fun `redeemBeans with zero amount is ignored`() = runTest {
        val vm = createViewModel()
        advanceUntilIdle()

        vm.redeemBeans(0)
        advanceUntilIdle()

        assertNull(vm.uiState.value.error)
        assertNull(vm.uiState.value.successMessage)
    }

    @Test
    fun `redeemBeans success shows message without bonus`() = runTest {
        coEvery { economyRepository.redeemBeans(500) } returns Resource.Success(emptyMap())

        val vm = createViewModel()
        advanceUntilIdle()

        vm.redeemBeans(500)
        advanceUntilIdle()

        val msg = vm.uiState.value.successMessage
        assertNotNull(msg)
        assertTrue(msg!!.contains("500"))
        assertFalse(msg.contains("bonus"))
    }

    @Test
    fun `redeemBeans 2000 or more shows bonus message`() = runTest {
        // Set balance high enough
        coEvery { userRepository.getUser("u1") } returns Resource.Success(sampleUser.copy(shyBeans = 5000))
        coEvery { economyRepository.redeemBeans(2000) } returns Resource.Success(emptyMap())

        val vm = createViewModel()
        advanceUntilIdle()

        vm.redeemBeans(2000)
        advanceUntilIdle()

        val msg = vm.uiState.value.successMessage
        assertNotNull(msg)
        assertTrue(msg!!.contains("bonus"))
    }

    @Test
    fun `redeemBeans failure sets error`() = runTest {
        coEvery { economyRepository.redeemBeans(500) } returns Resource.Error("Failed")

        val vm = createViewModel()
        advanceUntilIdle()

        vm.redeemBeans(500)
        advanceUntilIdle()

        assertEquals("Failed", vm.uiState.value.error)
        assertFalse(vm.uiState.value.isPurchasing)
    }

    @Test
    fun `onPurchaseCompleted coin purchase success`() = runTest {
        coEvery {
            economyRepository.purchaseCoins("coins_100", "token123")
        } returns Resource.Success(emptyMap())

        val vm = createViewModel()
        advanceUntilIdle()

        vm.onPurchaseCompleted("coins_100", "token123", isSubscription = false)
        advanceUntilIdle()

        assertEquals("Purchase successful!", vm.uiState.value.successMessage)
        assertFalse(vm.uiState.value.isPurchasing)
    }

    @Test
    fun `onPurchaseCompleted subscription purchase success`() = runTest {
        coEvery {
            economyRepository.purchaseSubscription("sub_gold", "token456")
        } returns Resource.Success(emptyMap())

        val vm = createViewModel()
        advanceUntilIdle()

        vm.onPurchaseCompleted("sub_gold", "token456", isSubscription = true)
        advanceUntilIdle()

        assertEquals("Purchase successful!", vm.uiState.value.successMessage)
    }

    @Test
    fun `onPurchaseCompleted failure sets error`() = runTest {
        coEvery {
            economyRepository.purchaseCoins("coins_100", "bad_token")
        } returns Resource.Error("Payment failed")

        val vm = createViewModel()
        advanceUntilIdle()

        vm.onPurchaseCompleted("coins_100", "bad_token", isSubscription = false)
        advanceUntilIdle()

        assertEquals("Payment failed", vm.uiState.value.error)
        assertFalse(vm.uiState.value.isPurchasing)
    }

    @Test
    fun `clearError clears error`() = runTest {
        coEvery { economyRepository.getCoinPackages() } returns Resource.Error("fail")

        val vm = createViewModel()
        advanceUntilIdle()

        assertNotNull(vm.uiState.value.error)
        vm.clearError()
        assertNull(vm.uiState.value.error)
    }

    @Test
    fun `clearSuccess clears success message`() = runTest {
        coEvery { economyRepository.addTestCoins(100) } returns Resource.Success(emptyMap())

        val vm = createViewModel()
        advanceUntilIdle()

        vm.testPurchaseCoins(100)
        advanceUntilIdle()

        assertNotNull(vm.uiState.value.successMessage)
        vm.clearSuccess()
        assertNull(vm.uiState.value.successMessage)
    }
}
