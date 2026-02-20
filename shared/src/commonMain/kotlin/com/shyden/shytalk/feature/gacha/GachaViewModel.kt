package com.shyden.shytalk.feature.gacha

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.CoinPackage
import com.shyden.shytalk.core.model.GachaGift
import com.shyden.shytalk.core.model.GachaResult
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.Transaction
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.GiftRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class GachaUiState(
    val giftCatalog: List<Gift> = emptyList(),
    val winnableGifts: List<Gift> = emptyList(),
    val pullResults: List<GachaGift> = emptyList(),
    val coinBalance: Long = 0,
    val pityCounter: Int = 0,
    val luckScore: Int = 0,
    val isPulling: Boolean = false,
    val error: String? = null,
    val showResults: Boolean = false,
    val currentWin: GachaGift? = null,
    val isMultiSpin: Boolean = false,
    val multiSpinResults: List<GachaGift> = emptyList(),
    val multiSpinIndex: Int = 0,
    val coinPackages: List<CoinPackage> = emptyList(),
    val spinHistory: List<Transaction> = emptyList()
)

class GachaViewModel(
    private val economyRepository: EconomyRepository,
    private val giftRepository: GiftRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(GachaUiState())
    val uiState: StateFlow<GachaUiState> = _uiState.asStateFlow()

    // Guard against stale Firestore snapshots overwriting the pull result balance
    private var pullBalanceSetAt = 0L

    init {
        observeGiftCatalog()
        observeBalance()
        loadCoinPackages()
        loadSpinHistory()
    }

    private fun observeGiftCatalog() {
        viewModelScope.launch {
            giftRepository.observeGiftCatalog()
                .catch { e -> _uiState.update { it.copy(error = e.message) } }
                .collect { gifts ->
                    _uiState.update {
                        it.copy(
                            giftCatalog = gifts,
                            winnableGifts = gifts.filter { g -> g.baseDropRate > 0 }
                        )
                    }
                }
        }
    }

    private fun observeBalance() {
        viewModelScope.launch {
            economyRepository.observeBalance()
                .catch { /* ignore */ }
                .collect { coins ->
                    // Ignore stale Firestore snapshots for 3s after a pull set the balance
                    val elapsed = System.currentTimeMillis() - pullBalanceSetAt
                    if (elapsed < 3000 && coins < _uiState.value.coinBalance) return@collect
                    _uiState.update { it.copy(coinBalance = coins) }
                }
        }
    }

    private fun loadCoinPackages() {
        viewModelScope.launch {
            when (val result = economyRepository.getCoinPackages()) {
                is Resource.Success -> _uiState.update { it.copy(coinPackages = result.data) }
                else -> {}
            }
        }
    }

    private fun loadSpinHistory(delayMs: Long = 0) {
        viewModelScope.launch {
            if (delayMs > 0) kotlinx.coroutines.delay(delayMs)
            when (val result = economyRepository.getAllTransactions("GACHA_PULL")) {
                is Resource.Success -> _uiState.update { it.copy(spinHistory = result.data) }
                else -> {}
            }
        }
    }

    fun testPurchase(amount: Int) {
        viewModelScope.launch {
            economyRepository.addTestCoins(amount)
        }
    }

    fun updateBalance(coins: Long, pity: Int, luck: Int) {
        _uiState.update { it.copy(coinBalance = coins, pityCounter = pity, luckScore = luck) }
    }

    fun pullSingle() = pull(1)
    fun pullTen() = pull(10)
    fun pullHundred() = pull(100)

    private fun pull(count: Int) {
        val cost = when (count) { 1 -> 10; 10 -> 100; 100 -> 1000; else -> return }
        if (_uiState.value.coinBalance < cost) {
            _uiState.update { it.copy(error = "Not enough coins") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isPulling = true, error = null, currentWin = null) }
            when (val result = economyRepository.pullGacha(count)) {
                is Resource.Success -> {
                    pullBalanceSetAt = System.currentTimeMillis()
                    if (count == 1) {
                        _uiState.update {
                            it.copy(
                                pullResults = result.data.gifts,
                                coinBalance = result.data.newBalance,
                                pityCounter = result.data.newPityCounter,
                                luckScore = result.data.newLuckScore,
                                isPulling = false,
                                currentWin = result.data.gifts.firstOrNull(),
                                isMultiSpin = false,
                                showResults = false
                            )
                        }
                    } else {
                        _uiState.update {
                            it.copy(
                                pullResults = result.data.gifts,
                                coinBalance = result.data.newBalance,
                                pityCounter = result.data.newPityCounter,
                                luckScore = result.data.newLuckScore,
                                isPulling = false,
                                isMultiSpin = true,
                                multiSpinResults = result.data.gifts,
                                multiSpinIndex = 0,
                                showResults = true
                            )
                        }
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isPulling = false, error = result.message) }
                }
                is Resource.Loading -> {}
            }
            // Delay to allow cloud function to write transaction doc
            loadSpinHistory(delayMs = 2000)
        }
    }

    fun advanceMultiSpin() {
        _uiState.update {
            val nextIndex = it.multiSpinIndex + 1
            it.copy(multiSpinIndex = nextIndex)
        }
    }

    fun skipMultiSpin() {
        _uiState.update {
            it.copy(
                multiSpinIndex = it.multiSpinResults.size,
                showResults = true
            )
        }
    }

    fun dismissResults() {
        _uiState.update {
            it.copy(
                showResults = false,
                pullResults = emptyList(),
                currentWin = null,
                isMultiSpin = false,
                multiSpinResults = emptyList(),
                multiSpinIndex = 0
            )
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
