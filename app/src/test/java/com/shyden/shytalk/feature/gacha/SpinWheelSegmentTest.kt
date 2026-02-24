package com.shyden.shytalk.feature.gacha

import com.shyden.shytalk.core.model.Gift
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SpinWheelSegmentTest {

    private val testGifts = listOf(
        Gift(id = "c1", name = "Rose", coinValue = 8, order = 1),
        Gift(id = "c2", name = "Heart", coinValue = 10, order = 2),
        Gift(id = "u1", name = "Gift Box", coinValue = 50, order = 3),
        Gift(id = "u2", name = "Potion", coinValue = 80, order = 4),
        Gift(id = "r1", name = "Crown", coinValue = 500, order = 5),
        Gift(id = "r2", name = "Treasure", coinValue = 800, order = 6),
        Gift(id = "e1", name = "Mystery", coinValue = 5000, order = 7),
        Gift(id = "l1", name = "Jackpot", coinValue = 35000, order = 8)
    )

    @Test
    fun `buildRingLayout puts low value gifts in outer ring`() {
        val (outer, _) = buildRingLayout(testGifts, innerThreshold = 500)
        assertTrue(outer.all { it.coinValue < 500 })
        assertEquals(4, outer.size)
    }

    @Test
    fun `buildRingLayout puts high value gifts in inner ring`() {
        val (_, inner) = buildRingLayout(testGifts, innerThreshold = 500)
        assertTrue(inner.all { it.coinValue >= 500 })
        assertEquals(4, inner.size)
    }

    @Test
    fun `buildRingLayout sorts by order field`() {
        val shuffled = testGifts.shuffled()
        val (outer, inner) = buildRingLayout(shuffled, innerThreshold = 500)
        assertEquals(listOf(1, 2, 3, 4), outer.map { it.order })
        assertEquals(listOf(5, 6, 7, 8), inner.map { it.order })
    }

    @Test
    fun `buildRingLayout returns empty lists for empty input`() {
        val (outer, inner) = buildRingLayout(emptyList())
        assertTrue(outer.isEmpty())
        assertTrue(inner.isEmpty())
    }

    @Test
    fun `buildRingLayout handles only low value gifts`() {
        val lowOnly = testGifts.filter { it.coinValue < 500 }
        val (outer, inner) = buildRingLayout(lowOnly, innerThreshold = 500)
        assertEquals(4, outer.size)
        assertTrue(inner.isEmpty())
    }

    @Test
    fun `buildRingLayout handles only high value gifts`() {
        val highOnly = testGifts.filter { it.coinValue >= 500 }
        val (outer, inner) = buildRingLayout(highOnly, innerThreshold = 500)
        assertTrue(outer.isEmpty())
        assertEquals(4, inner.size)
    }

    @Test
    fun `resolveWinPosition finds gift in outer ring`() {
        val (outer, inner) = buildRingLayout(testGifts, innerThreshold = 500)
        val result = resolveWinPosition("c1", outer, inner)
        assertNotNull(result)
        assertEquals(Ring.OUTER, result!!.first)
        assertEquals(0, result.second) // first in sorted outer list
    }

    @Test
    fun `resolveWinPosition finds gift in inner ring`() {
        val (outer, inner) = buildRingLayout(testGifts, innerThreshold = 500)
        val result = resolveWinPosition("r1", outer, inner)
        assertNotNull(result)
        assertEquals(Ring.INNER, result!!.first)
        assertEquals(0, result.second) // first in sorted inner list
    }

    @Test
    fun `resolveWinPosition returns null for unknown ID`() {
        val (outer, inner) = buildRingLayout(testGifts, innerThreshold = 500)
        val result = resolveWinPosition("nonexistent", outer, inner)
        assertNull(result)
    }

    @Test
    fun `resolveWinPosition returns correct index for later gift`() {
        val (outer, inner) = buildRingLayout(testGifts, innerThreshold = 500)
        val result = resolveWinPosition("l1", outer, inner)
        assertNotNull(result)
        assertEquals(Ring.INNER, result!!.first)
        assertEquals(3, result.second) // 4th item in inner (r1, r2, e1, l1)
    }
}
