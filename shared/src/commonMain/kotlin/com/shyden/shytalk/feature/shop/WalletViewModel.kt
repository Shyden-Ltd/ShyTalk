package com.shyden.shytalk.feature.shop

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.CoinPackage
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class WalletUiState(
    val coinPackages: List<CoinPackage> = emptyList(),
    val coinBalance: Long = 0,
    val beanBalance: Long = 0,
    val isSuperShy: Boolean = false,
    val superShyTier: String? = null,
    val superShyExpiry: Long? = null,
    val isLoading: Boolean = true,
    val isPurchasing: Boolean = false,
    val error: UiText? = null,
    val successMessage: UiText? = null,
)

class WalletViewModel(
    private val economyRepository: EconomyRepository,
    private val userRepository: UserRepository,
    private val authRepository: AuthRepository,
) : ViewModel() {
    companion object {
        private const val TAG = "WalletViewModel"
    }

    private val _uiState = MutableStateFlow(WalletUiState())
    val uiState: StateFlow<WalletUiState> = _uiState.asStateFlow()

    init {
        logI(TAG, "Loading wallet data")
        loadData()
    }

    private fun loadData() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true) }

            // Load coin packages
            when (val result = economyRepository.getCoinPackages()) {
                is Resource.Success -> _uiState.update { it.copy(coinPackages = result.data) }
                is Resource.Error -> _uiState.update { it.copy(error = UiText.plain(result.message)) }
                is Resource.Loading -> {}
            }

            // Load user balance
            refreshBalance()
        }
    }

    private suspend fun refreshBalance() {
        val userId = authRepository.currentUserId ?: return
        when (val result = userRepository.getUser(userId)) {
            is Resource.Success -> {
                val user = result.data
                _uiState.update {
                    it.copy(
                        coinBalance = user.shyCoins,
                        beanBalance = user.shyBeans,
                        isSuperShy = user.isSuperShy,
                        superShyTier = user.superShyTier,
                        superShyExpiry = user.superShyExpiry,
                        isLoading = false,
                    )
                }
            }
            is Resource.Error -> _uiState.update { it.copy(isLoading = false, error = UiText.plain(result.message)) }
            is Resource.Loading -> {}
        }
    }

    fun onPurchaseCompleted(
        productId: String,
        purchaseToken: String,
        isSubscription: Boolean,
    ) {
        viewModelScope.launch {
            _uiState.update { it.copy(isPurchasing = true) }
            val result =
                if (isSubscription) {
                    economyRepository.purchaseSubscription(productId, purchaseToken)
                } else {
                    economyRepository.purchaseCoins(productId, purchaseToken)
                }
            when (result) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isPurchasing = false, successMessage = UiText.res(Res.string.success_purchase)) }
                    refreshBalance()
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isPurchasing = false, error = UiText.plain(result.message)) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun redeemBeans(amount: Long) {
        if (amount < 1) return
        if (amount > _uiState.value.beanBalance) {
            _uiState.update { it.copy(error = UiText.res(Res.string.error_not_enough_beans)) }
            return
        }
        viewModelScope.launch {
            _uiState.update { it.copy(isPurchasing = true) }
            when (val result = economyRepository.redeemBeans(amount)) {
                is Resource.Success -> {
                    val res =
                        if (amount >= 2000) {
                            Res.string.success_redeemed_beans_bonus
                        } else {
                            Res.string.success_redeemed_beans
                        }
                    _uiState.update {
                        it.copy(
                            isPurchasing = false,
                            successMessage = UiText.res(res, formatNumber(amount)),
                        )
                    }
                    refreshBalance()
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isPurchasing = false, error = UiText.plain(result.message)) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun testPurchaseCoins(coins: Int) {
        viewModelScope.launch {
            _uiState.update { it.copy(isPurchasing = true) }
            when (val result = economyRepository.addTestCoins(coins)) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            isPurchasing = false,
                            successMessage = UiText.res(Res.string.success_coins_added, formatNumber(coins.toLong())),
                        )
                    }
                    refreshBalance()
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isPurchasing = false, error = UiText.plain(result.message)) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun clearSuccess() {
        _uiState.update { it.copy(successMessage = null) }
    }
}
