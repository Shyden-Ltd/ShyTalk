package com.shyden.shytalk.feature.shop

import com.shyden.shytalk.core.model.CoinPackage
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class WalletUiStateTest {
    @Test
    fun `default state has zero balances`() {
        val state = WalletUiState()
        assertEquals(0L, state.coinBalance)
        assertEquals(0L, state.beanBalance)
    }

    @Test
    fun `default state is loading`() {
        val state = WalletUiState()
        assertTrue(state.isLoading)
    }

    @Test
    fun `default state is not purchasing`() {
        val state = WalletUiState()
        assertFalse(state.isPurchasing)
    }

    @Test
    fun `default state has no messages`() {
        val state = WalletUiState()
        assertNull(state.error)
        assertNull(state.successMessage)
    }

    @Test
    fun `default state has empty packages`() {
        val state = WalletUiState()
        assertTrue(state.coinPackages.isEmpty())
    }

    @Test
    fun `default state has no super shy`() {
        val state = WalletUiState()
        assertFalse(state.isSuperShy)
        assertNull(state.superShyTier)
        assertNull(state.superShyExpiry)
    }

    @Test
    fun `copy preserves unmodified fields`() {
        val state = WalletUiState(coinBalance = 500, beanBalance = 200)
        val updated = state.copy(coinBalance = 300)
        assertEquals(300L, updated.coinBalance)
        assertEquals(200L, updated.beanBalance)
    }

    @Test
    fun `CoinPackage totalCoins includes bonus`() {
        val pkg = CoinPackage(coins = 500, bonusCoins = 50)
        assertEquals(550, pkg.totalCoins)
    }

    @Test
    fun `CoinPackage totalCoins with no bonus`() {
        val pkg = CoinPackage(coins = 100, bonusCoins = 0)
        assertEquals(100, pkg.totalCoins)
    }

    @Test
    fun `CoinPackage fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "productId" to "coins_100",
                "coins" to 100L,
                "bonusCoins" to 10L,
                "displayPrice" to "$0.99",
                "order" to 1L,
                "isActive" to true,
            )
        val pkg = CoinPackage.fromMap(map, "pkg1")
        assertEquals("pkg1", pkg.id)
        assertEquals("coins_100", pkg.productId)
        assertEquals(100, pkg.coins)
        assertEquals(10, pkg.bonusCoins)
        assertEquals("$0.99", pkg.displayPrice)
        assertEquals(1, pkg.order)
        assertTrue(pkg.isActive)
    }

    @Test
    fun `CoinPackage fromMap with empty map uses defaults`() {
        val pkg = CoinPackage.fromMap(emptyMap(), "x")
        assertEquals("x", pkg.id)
        assertEquals("", pkg.productId)
        assertEquals(0, pkg.coins)
        assertEquals(0, pkg.bonusCoins)
        assertEquals("", pkg.displayPrice)
        assertEquals(0, pkg.order)
        assertTrue(pkg.isActive)
    }

    @Test
    fun `CoinPackage fromMap inactive package`() {
        val map = mapOf<String, Any?>("isActive" to false)
        val pkg = CoinPackage.fromMap(map, "id")
        assertFalse(pkg.isActive)
    }
}
