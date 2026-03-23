package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class CoinPackageFromMapTest {
    @Test
    fun `complete valid map parses correctly`() {
        val map =
            mapOf<String, Any?>(
                "productId" to "com.app.coins100",
                "coins" to 100L,
                "bonusCoins" to 20L,
                "displayPrice" to "$0.99",
                "order" to 1L,
                "isActive" to true,
            )
        val pkg = CoinPackage.fromMap(map, "pkg-1")

        assertEquals("pkg-1", pkg.id)
        assertEquals("com.app.coins100", pkg.productId)
        assertEquals(100, pkg.coins)
        assertEquals(20, pkg.bonusCoins)
        assertEquals("$0.99", pkg.displayPrice)
        assertEquals(1, pkg.order)
        assertTrue(pkg.isActive)
    }

    @Test
    fun `empty map returns defaults`() {
        val pkg = CoinPackage.fromMap(emptyMap(), "pkg-1")

        assertEquals("pkg-1", pkg.id)
        assertEquals("", pkg.productId)
        assertEquals(0, pkg.coins)
        assertEquals(0, pkg.bonusCoins)
        assertEquals("", pkg.displayPrice)
        assertEquals(0, pkg.order)
        assertTrue(pkg.isActive) // default is true
    }

    @Test
    fun `totalCoins returns coins plus bonusCoins`() {
        val pkg = CoinPackage(coins = 100, bonusCoins = 25)
        assertEquals(125, pkg.totalCoins)
    }

    @Test
    fun `Long-to-Int conversion works for Firestore values`() {
        val map =
            mapOf<String, Any?>(
                "coins" to 999999L,
                "bonusCoins" to 50000L,
                "order" to 5L,
            )
        val pkg = CoinPackage.fromMap(map, "pkg-2")

        assertEquals(999999, pkg.coins)
        assertEquals(50000, pkg.bonusCoins)
        assertEquals(5, pkg.order)
    }

    @Test
    fun `isActive defaults to true when missing`() {
        val map =
            mapOf<String, Any?>(
                "coins" to 10L,
            )
        val pkg = CoinPackage.fromMap(map, "pkg-3")
        assertTrue(pkg.isActive)
    }

    @Test
    fun `isActive false parses correctly`() {
        val map =
            mapOf<String, Any?>(
                "isActive" to false,
            )
        val pkg = CoinPackage.fromMap(map, "pkg-4")
        assertEquals(false, pkg.isActive)
    }
}
