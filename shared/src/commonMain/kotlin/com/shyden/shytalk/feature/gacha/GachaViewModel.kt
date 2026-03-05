package com.shyden.shytalk.feature.gacha

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.CoinPackage
import com.shyden.shytalk.core.model.EconomyConfig
import com.shyden.shytalk.core.model.GachaGift
import com.shyden.shytalk.core.model.GachaResult
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.Transaction
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
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
    val isPulling: Boolean = false,
    val error: String? = null,
    val showResults: Boolean = false,
    val currentWin: GachaGift? = null,
    val isMultiSpin: Boolean = false,
    val multiSpinResults: List<GachaGift> = emptyList(),
    val multiSpinIndex: Int = 0,
    val coinPackages: List<CoinPackage> = emptyList(),
    val spinHistory: List<Transaction> = emptyList(),
    val pullCosts: Map<Int, Int> = emptyMap(),
    val configLoaded: Boolean = false,
    val wheelInnerThreshold: Int = 18888
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
        observeConfig()
        loadCoinPackages()
        loadSpinHistory()
    }

    private fun observeGiftCatalog() {
        viewModelScope.launch {
            giftRepository.observeAllGifts()
                .catch { e -> _uiState.update { it.copy(error = e.message) } }
                .collect { gifts ->
                    val wheelGifts = gifts.filter { g -> g.showOnWheel && g.coinValue > 0 }
                    _uiState.update {
                        it.copy(
                            giftCatalog = gifts,
                            winnableGifts = padToWheelSize(wheelGifts)
                        )
                    }
                }
        }
    }

    /** Pads or trims the gift list to exactly [WHEEL_SIZE] items by repeating. */
    private fun padToWheelSize(gifts: List<Gift>): List<Gift> {
        if (gifts.isEmpty()) return emptyList()
        if (gifts.size >= WHEEL_SIZE) return gifts.take(WHEEL_SIZE)
        val padded = mutableListOf<Gift>()
        while (padded.size < WHEEL_SIZE) {
            padded.addAll(gifts)
        }
        return padded.take(WHEEL_SIZE)
    }

    companion object {
        const val WHEEL_SIZE = 16
    }

    private fun observeConfig() {
        viewModelScope.launch {
            economyRepository.observeEconomyConfig()
                .catch { /* ignore */ }
                .collect { config ->
                    _uiState.update {
                        it.copy(
                            pullCosts = config.pullCosts,
                            configLoaded = config.pullCosts.isNotEmpty(),
                            wheelInnerThreshold = config.wheelInnerThreshold
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
                    val elapsed = currentTimeMillis() - pullBalanceSetAt
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

    fun updateBalance(coins: Long, pity: Int) {
        _uiState.update { it.copy(coinBalance = coins, pityCounter = pity) }
    }

    fun pullSingle() = pull(1)
    fun pullTen() = pull(10)
    fun pullHundred() = pull(100)

    private fun pull(count: Int) {
        val cost = _uiState.value.pullCosts[count] ?: return
        if (_uiState.value.coinBalance < cost) {
            _uiState.update { it.copy(error = "Not enough coins") }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isPulling = true, error = null, currentWin = null) }
            when (val result = economyRepository.pullGacha(count, expectedCost = cost)) {
                is Resource.Success -> {
                    // Check if prices changed since we last loaded
                    if (result.data.priceChanged) {
                        val newCosts = result.data.currentPullCosts
                        _uiState.update {
                            it.copy(
                                isPulling = false,
                                pullCosts = newCosts ?: it.pullCosts,
                                error = "Prices have changed! Please check the new costs and try again."
                            )
                        }
                        return@launch
                    }

                    // Update pull costs from server response if available
                    val latestCosts = result.data.currentPullCosts

                    pullBalanceSetAt = currentTimeMillis()
                    if (count == 1) {
                        _uiState.update {
                            it.copy(
                                pullResults = result.data.gifts,
                                coinBalance = result.data.newBalance,
                                pityCounter = result.data.newPityCounter,
                                isPulling = false,
                                currentWin = result.data.gifts.firstOrNull(),
                                isMultiSpin = false,
                                showResults = false,
                                pullCosts = latestCosts ?: it.pullCosts
                            )
                        }
                    } else {
                        _uiState.update {
                            it.copy(
                                pullResults = result.data.gifts,
                                coinBalance = result.data.newBalance,
                                pityCounter = result.data.newPityCounter,
                                isPulling = false,
                                isMultiSpin = true,
                                multiSpinResults = result.data.gifts,
                                multiSpinIndex = 0,
                                showResults = true,
                                pullCosts = latestCosts ?: it.pullCosts
                            )
                        }
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isPulling = false, error = result.message) }
                }
                is Resource.Loading -> {}
            }
            loadSpinHistory()
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
