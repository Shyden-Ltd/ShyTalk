package com.shyden.shytalk.feature.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.GiftRankEntry
import com.shyden.shytalk.core.model.GiftSender
import com.shyden.shytalk.core.model.GiftWallEntry
import com.shyden.shytalk.data.repository.GiftRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.catch
import kotlinx.coroutines.flow.combine
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class GiftWallUiState(
    val wallEntries: List<GiftWallEntry> = emptyList(),
    val giftCatalog: List<Gift> = emptyList(),
    val selectedGiftId: String? = null,
    val senders: List<GiftSender> = emptyList(),
    val ranking: List<GiftRankEntry> = emptyList(),
    val isLoadingDetails: Boolean = false,
    val error: String? = null
)

class GiftWallViewModel(
    private val userId: String,
    private val giftRepository: GiftRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(GiftWallUiState())
    val uiState: StateFlow<GiftWallUiState> = _uiState.asStateFlow()

    init {
        observeData()
    }

    private fun observeData() {
        viewModelScope.launch {
            combine(
                giftRepository.observeGiftCatalog(),
                giftRepository.observeGiftWall(userId)
            ) { catalog, wall ->
                catalog to wall
            }.catch { e ->
                _uiState.update { it.copy(error = e.message) }
            }.collect { (catalog, wall) ->
                _uiState.update {
                    it.copy(giftCatalog = catalog, wallEntries = wall)
                }
            }
        }
    }

    fun selectGift(giftId: String) {
        _uiState.update { it.copy(selectedGiftId = giftId, isLoadingDetails = true) }
        viewModelScope.launch {
            try {
                val senders = giftRepository.getGiftWallSenders(userId, giftId)
                val ranking = giftRepository.getGiftRanking(giftId)
                _uiState.update {
                    it.copy(senders = senders, ranking = ranking, isLoadingDetails = false)
                }
            } catch (e: Exception) {
                _uiState.update { it.copy(isLoadingDetails = false, error = e.message) }
            }
        }
    }

    fun dismissDetails() {
        _uiState.update { it.copy(selectedGiftId = null, senders = emptyList(), ranking = emptyList()) }
    }
}
