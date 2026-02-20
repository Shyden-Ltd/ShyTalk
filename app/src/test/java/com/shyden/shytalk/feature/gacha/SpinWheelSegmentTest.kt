package com.shyden.shytalk.feature.gacha

import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.GiftBracket
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class SpinWheelSegmentTest {

    private val testGifts = listOf(
        Gift(id = "c1", name = "Rose", baseDropRate = 20.0, bracket = GiftBracket.COMMON, order = 1),
        Gift(id = "c2", name = "Heart", baseDropRate = 20.0, bracket = GiftBracket.COMMON, order = 2),
        Gift(id = "u1", name = "Gift Box", baseDropRate = 15.0, bracket = GiftBracket.UNCOMMON, order = 3),
        Gift(id = "u2", name = "Potion", baseDropRate = 15.0, bracket = GiftBracket.UNCOMMON, order = 4),
        Gift(id = "r1", name = "Crown", baseDropRate = 10.0, bracket = GiftBracket.RARE, order = 5),
        Gift(id = "r2", name = "Treasure", baseDropRate = 10.0, bracket = GiftBracket.RARE, order = 6),
        Gift(id = "e1", name = "Mystery", baseDropRate = 5.0, bracket = GiftBracket.EPIC, order = 7),
        Gift(id = "l1", name = "Jackpot", baseDropRate = 5.0, bracket = GiftBracket.LEGENDARY, order = 8)
    )

    @Test
    fun `buildRingLayout puts COMMON and UNCOMMON in outer ring`() {
        val (outer, _) = buildRingLayout(testGifts)
        assertTrue(outer.all { it.bracket == GiftBracket.COMMON || it.bracket == GiftBracket.UNCOMMON })
        assertEquals(4, outer.size)
    }

    @Test
    fun `buildRingLayout puts RARE EPIC LEGENDARY in inner ring`() {
        val (_, inner) = buildRingLayout(testGifts)
        assertTrue(inner.all {
            it.bracket == GiftBracket.RARE || it.bracket == GiftBracket.EPIC || it.bracket == GiftBracket.LEGENDARY
        })
        assertEquals(4, inner.size)
    }

    @Test
    fun `buildRingLayout sorts by order field`() {
        val shuffled = testGifts.shuffled()
        val (outer, inner) = buildRingLayout(shuffled)
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
    fun `buildRingLayout handles only COMMON gifts`() {
        val commonOnly = testGifts.filter { it.bracket == GiftBracket.COMMON }
        val (outer, inner) = buildRingLayout(commonOnly)
        assertEquals(2, outer.size)
        assertTrue(inner.isEmpty())
    }

    @Test
    fun `buildRingLayout handles only RARE gifts`() {
        val rareOnly = testGifts.filter { it.bracket == GiftBracket.RARE }
        val (outer, inner) = buildRingLayout(rareOnly)
        assertTrue(outer.isEmpty())
        assertEquals(2, inner.size)
    }

    @Test
    fun `resolveWinPosition finds gift in outer ring`() {
        val (outer, inner) = buildRingLayout(testGifts)
        val result = resolveWinPosition("c1", outer, inner)
        assertNotNull(result)
        assertEquals(Ring.OUTER, result!!.first)
        assertEquals(0, result.second) // first in sorted outer list
    }

    @Test
    fun `resolveWinPosition finds gift in inner ring`() {
        val (outer, inner) = buildRingLayout(testGifts)
        val result = resolveWinPosition("r1", outer, inner)
        assertNotNull(result)
        assertEquals(Ring.INNER, result!!.first)
        assertEquals(0, result.second) // first in sorted inner list
    }

    @Test
    fun `resolveWinPosition returns null for unknown ID`() {
        val (outer, inner) = buildRingLayout(testGifts)
        val result = resolveWinPosition("nonexistent", outer, inner)
        assertNull(result)
    }

    @Test
    fun `resolveWinPosition returns correct index for later gift`() {
        val (outer, inner) = buildRingLayout(testGifts)
        val result = resolveWinPosition("l1", outer, inner)
        assertNotNull(result)
        assertEquals(Ring.INNER, result!!.first)
        assertEquals(3, result.second) // 4th item in inner (r1, r2, e1, l1)
    }
}
