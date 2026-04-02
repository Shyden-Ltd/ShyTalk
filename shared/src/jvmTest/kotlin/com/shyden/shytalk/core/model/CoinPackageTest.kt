package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

class CoinPackageTest {
    // ── fromMap basic ───────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "productId" to "com.shyden.coins_500",
                "coins" to 500,
                "bonusCoins" to 50,
                "displayPrice" to "$4.99",
                "order" to 2,
                "isActive" to true,
            )

        val pkg = CoinPackage.fromMap(map, "pkg-1")

        assertEquals("pkg-1", pkg.id)
        assertEquals("com.shyden.coins_500", pkg.productId)
        assertEquals(500, pkg.coins)
        assertEquals(50, pkg.bonusCoins)
        assertEquals("$4.99", pkg.displayPrice)
        assertEquals(2, pkg.order)
        assertTrue(pkg.isActive)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val pkg = CoinPackage.fromMap(emptyMap(), "pkg-2")

        assertEquals("pkg-2", pkg.id)
        assertEquals("", pkg.productId)
        assertEquals(0, pkg.coins)
        assertEquals(0, pkg.bonusCoins)
        assertEquals("", pkg.displayPrice)
        assertEquals(0, pkg.order)
        assertTrue(pkg.isActive)
    }

    // ── Computed properties ─────────────────────────────────────────

    @Test
    fun `totalCoins sums coins and bonusCoins`() {
        val pkg = CoinPackage(coins = 500, bonusCoins = 50)
        assertEquals(550, pkg.totalCoins)
    }

    @Test
    fun `totalCoins is zero when both are zero`() {
        val pkg = CoinPackage(coins = 0, bonusCoins = 0)
        assertEquals(0, pkg.totalCoins)
    }

    // ── Number type coercion ────────────────────────────────────────

    @Test
    fun `fromMap handles Long values for Int fields`() {
        val map =
            mapOf<String, Any?>(
                "coins" to 500L,
                "bonusCoins" to 50L,
                "order" to 3L,
            )

        val pkg = CoinPackage.fromMap(map, "pkg-3")

        assertEquals(500, pkg.coins)
        assertEquals(50, pkg.bonusCoins)
        assertEquals(3, pkg.order)
    }

    @Test
    fun `fromMap handles Double values for Int fields`() {
        val map =
            mapOf<String, Any?>(
                "coins" to 500.0,
                "bonusCoins" to 50.0,
                "order" to 1.0,
            )

        val pkg = CoinPackage.fromMap(map, "pkg-4")

        assertEquals(500, pkg.coins)
        assertEquals(50, pkg.bonusCoins)
        assertEquals(1, pkg.order)
    }

    // ── Boolean coercion ────────────────────────────────────────────

    @Test
    fun `fromMap handles integer boolean for isActive`() {
        val mapActive = mapOf<String, Any?>("isActive" to 1)
        val mapInactive = mapOf<String, Any?>("isActive" to 0)

        assertTrue(CoinPackage.fromMap(mapActive, "pkg-5").isActive)
        assertFalse(CoinPackage.fromMap(mapInactive, "pkg-6").isActive)
    }

    @Test
    fun `fromMap defaults isActive to true when missing`() {
        val map = mapOf<String, Any?>("coins" to 100)
        val pkg = CoinPackage.fromMap(map, "pkg-7")
        assertTrue(pkg.isActive)
    }

    @Test
    fun `fromMap defaults isActive to true when null`() {
        val map = mapOf<String, Any?>("isActive" to null)
        val pkg = CoinPackage.fromMap(map, "pkg-8")
        assertTrue(pkg.isActive)
    }
}
