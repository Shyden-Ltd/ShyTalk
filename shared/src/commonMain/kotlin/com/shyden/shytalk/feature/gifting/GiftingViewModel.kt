package com.shyden.shytalk.feature.gifting

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.BackpackItem
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.GiftRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class GiftingUiState(
    val backpackItems: List<BackpackItem> = emptyList(),
    val giftCatalog: List<Gift> = emptyList(),
    val selectedGiftId: String? = null,
    val isSending: Boolean = false,
    val sentGiftName: String? = null,
    val sentGiftId: String? = null,
    val error: String? = null
)

class GiftingViewModel(
    private val giftRepository: GiftRepository,
    private val economyRepository: EconomyRepository,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(GiftingUiState())
    val uiState: StateFlow<GiftingUiState> = _uiState.asStateFlow()

    init {
        observeData()
    }

    private fun observeData() {
        val userId = authRepository.currentUserId ?: return
        viewModelScope.launch {
            combine(
                giftRepository.observeGiftCatalog(),
                giftRepository.observeBackpack(userId)
            ) { catalog, backpack ->
                catalog to backpack
            }.catch { e ->
                _uiState.update { it.copy(error = e.message) }
            }.collect { (catalog, backpack) ->
                _uiState.update {
                    it.copy(giftCatalog = catalog, backpackItems = backpack)
                }
            }
        }
    }

    fun selectGift(giftId: String?) {
        _uiState.update { it.copy(selectedGiftId = giftId) }
    }

    fun sendGift(recipientId: String, giftId: String) {
        viewModelScope.launch {
            _uiState.update { it.copy(isSending = true, error = null) }
            when (val result = economyRepository.sendGift(recipientId, giftId)) {
                is Resource.Success -> {
                    val giftName = result.data["giftName"] as? String ?: ""
                    _uiState.update {
                        it.copy(
                            isSending = false,
                            selectedGiftId = null,
                            sentGiftName = giftName,
                            sentGiftId = giftId
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isSending = false, error = result.message) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun clearSentGift() {
        _uiState.update { it.copy(sentGiftName = null, sentGiftId = null) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
