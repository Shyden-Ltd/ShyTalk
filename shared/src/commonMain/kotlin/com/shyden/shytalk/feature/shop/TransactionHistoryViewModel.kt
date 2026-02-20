package com.shyden.shytalk.feature.shop

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.Transaction
import com.shyden.shytalk.core.model.TransactionType
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.EconomyRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class TransactionHistoryUiState(
    val transactions: List<Transaction> = emptyList(),
    val isLoading: Boolean = true,
    val selectedFilter: String? = null, // null = "All"
    val error: String? = null
)

class TransactionHistoryViewModel(
    private val economyRepository: EconomyRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(TransactionHistoryUiState())
    val uiState: StateFlow<TransactionHistoryUiState> = _uiState.asStateFlow()

    init {
        loadTransactions()
    }

    fun setFilter(filter: String?) {
        _uiState.update { it.copy(selectedFilter = filter) }
        loadTransactions()
    }

    private fun loadTransactions() {
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }

            val filter = _uiState.value.selectedFilter

            // "Gifts" is a client-side composite filter for GIFT_SENT + GIFT_RECEIVED
            val serverFilter = when (filter) {
                "Gifts" -> null // load all, filter client-side
                "Purchases" -> TransactionType.PURCHASE.name
                "Gacha" -> TransactionType.GACHA_PULL.name
                "Rewards" -> TransactionType.DAILY_REWARD.name
                "Redemptions" -> TransactionType.BEAN_REDEEM.name
                else -> null // "All"
            }

            when (val result = economyRepository.getAllTransactions(serverFilter)) {
                is Resource.Success -> {
                    val transactions = if (filter == "Gifts") {
                        result.data.filter {
                            it.type == TransactionType.GIFT_SENT || it.type == TransactionType.GIFT_RECEIVED
                        }
                    } else {
                        result.data
                    }
                    _uiState.update { it.copy(transactions = transactions, isLoading = false) }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = result.message) }
                }
                is Resource.Loading -> {}
            }
        }
    }
}
