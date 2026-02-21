package com.shyden.shytalk.feature.gacha

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class GachaUiStateTest {

    @Test
    fun `default state has zero balance and pity`() {
        val state = GachaUiState()
        assertEquals(0L, state.coinBalance)
        assertEquals(0, state.pityCounter)
    }

    @Test
    fun `default state has no error`() {
        val state = GachaUiState()
        assertNull(state.error)
    }

    @Test
    fun `default state is not pulling`() {
        val state = GachaUiState()
        assertFalse(state.isPulling)
    }

    @Test
    fun `default state has empty gift lists`() {
        val state = GachaUiState()
        assertTrue(state.giftCatalog.isEmpty())
        assertTrue(state.winnableGifts.isEmpty())
        assertTrue(state.pullResults.isEmpty())
        assertTrue(state.multiSpinResults.isEmpty())
    }

    @Test
    fun `default state has no current win`() {
        val state = GachaUiState()
        assertNull(state.currentWin)
        assertFalse(state.showResults)
        assertFalse(state.isMultiSpin)
        assertEquals(0, state.multiSpinIndex)
    }

    @Test
    fun `copy preserves unmodified fields`() {
        val state = GachaUiState(coinBalance = 500, pityCounter = 10)
        val updated = state.copy(coinBalance = 400)
        assertEquals(400L, updated.coinBalance)
        assertEquals(10, updated.pityCounter)
    }

    @Test
    fun `state does not contain luckScore field`() {
        // Verify GachaUiState has no luckScore property via reflection
        val fields = GachaUiState::class.java.declaredFields.map { it.name }
        assertFalse("GachaUiState should not have luckScore", fields.contains("luckScore"))
    }

    @Test
    fun `default pullCosts is empty until config loads`() {
        val state = GachaUiState()
        assertTrue(state.pullCosts.isEmpty())
        assertFalse(state.configLoaded)
    }
}
