package com.shyden.shytalk.feature.gifting

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.BackpackItem
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.util.Constants
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
    val error: String? = null,
    val coinBalance: Long = 0,
    val selectedQuantity: Int = 1,
    val selectedRecipientIds: Set<String> = emptySet(),
    val isAllSelected: Boolean = false,
    val showQuantityPicker: Boolean = false,
    val showConfirmDialog: Boolean = false,
    val showSendAllConfirm: Boolean = false,
    val sendAllRecipientId: String? = null,
    val activeTab: Int = 0,
    val navigateToWallet: Boolean = false
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
                giftRepository.observeAllGifts(),
                giftRepository.observeBackpack(userId),
                economyRepository.observeBalance()
            ) { catalog, backpack, balance ->
                Triple(catalog, backpack, balance)
            }.catch { e ->
                _uiState.update { it.copy(error = e.message) }
            }.collect { (catalog, backpack, balance) ->
                val validBackpack = backpack.filter { !it.isExpired }
                // Inject trial gift into catalog if user has it in backpack
                val hasTrial = validBackpack.any { it.giftId == Constants.SUPER_SHY_TRIAL_ID }
                val effectiveCatalog = if (hasTrial && catalog.none { it.id == Constants.SUPER_SHY_TRIAL_ID }) {
                    catalog + Gift.SUPER_SHY_TRIAL
                } else {
                    catalog
                }
                _uiState.update {
                    it.copy(giftCatalog = effectiveCatalog, backpackItems = validBackpack, coinBalance = balance)
                }
            }
        }
    }

    fun selectGift(giftId: String?) {
        _uiState.update { it.copy(selectedGiftId = giftId, selectedQuantity = 1) }
    }

    fun setQuantity(quantity: Int) {
        _uiState.update { it.copy(selectedQuantity = quantity.coerceAtLeast(1)) }
    }

    fun toggleQuantityPicker() {
        _uiState.update { it.copy(showQuantityPicker = !it.showQuantityPicker) }
    }

    fun toggleRecipient(userId: String) {
        _uiState.update {
            val newSet = it.selectedRecipientIds.toMutableSet()
            if (userId in newSet) newSet.remove(userId) else newSet.add(userId)
            it.copy(selectedRecipientIds = newSet, isAllSelected = false)
        }
    }

    fun selectAllRecipients(seatedUserIds: Set<String>) {
        val currentUserId = authRepository.currentUserId ?: return
        val filtered = seatedUserIds.filter { it != currentUserId }.toSet()
        _uiState.update { it.copy(selectedRecipientIds = filtered, isAllSelected = true) }
    }

    fun deselectAllRecipients() {
        _uiState.update { it.copy(selectedRecipientIds = emptySet(), isAllSelected = false) }
    }

    fun setActiveTab(tab: Int) {
        _uiState.update { it.copy(activeTab = tab, selectedGiftId = null, selectedQuantity = 1) }
    }

    fun requestSend() {
        val state = _uiState.value
        if (state.selectedGiftId == null || state.selectedRecipientIds.isEmpty()) return
        _uiState.update { it.copy(showConfirmDialog = true) }
    }

    fun dismissConfirmDialog() {
        _uiState.update { it.copy(showConfirmDialog = false) }
    }

    fun confirmSend() {
        val state = _uiState.value
        val giftId = state.selectedGiftId ?: return
        val recipients = state.selectedRecipientIds.toList()
        val quantity = state.selectedQuantity
        val isBackpackTab = state.activeTab == 1

        if (!isBackpackTab) {
            val gift = state.giftCatalog.find { it.id == giftId } ?: return
            val totalCost = gift.coinValue.toLong() * quantity * recipients.size
            if (totalCost > state.coinBalance) {
                _uiState.update { it.copy(showConfirmDialog = false, navigateToWallet = true) }
                return
            }
        }

        _uiState.update { it.copy(showConfirmDialog = false, isSending = true, error = null) }

        viewModelScope.launch {
            val result = if (recipients.size == 1) {
                val recipientId = recipients.first()
                if (isBackpackTab) {
                    economyRepository.sendGift(recipientId, giftId, quantity)
                } else {
                    economyRepository.sendGiftDirect(recipientId, giftId, quantity)
                }
            } else {
                economyRepository.sendGiftBatch(recipients, giftId, quantity, fromBackpack = isBackpackTab)
            }

            when (result) {
                is Resource.Success -> {
                    val giftName = result.data["giftName"] as? String ?: ""
                    _uiState.update {
                        it.copy(
                            isSending = false,
                            selectedGiftId = null,
                            selectedQuantity = 1,
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

    /** Legacy single-recipient send (kept for backward compat) */
    fun sendGift(recipientId: String, giftId: String) {
        val ownsGift = _uiState.value.backpackItems.any { it.giftId == giftId && it.quantity > 0 }
        viewModelScope.launch {
            _uiState.update { it.copy(isSending = true, error = null) }
            val result = if (ownsGift) {
                economyRepository.sendGift(recipientId, giftId)
            } else {
                economyRepository.sendGiftDirect(recipientId, giftId)
            }
            when (result) {
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

    fun requestSendAll(recipientId: String) {
        if (_uiState.value.backpackItems.isEmpty()) return
        _uiState.update { it.copy(showSendAllConfirm = true, sendAllRecipientId = recipientId) }
    }

    fun dismissSendAllConfirm() {
        _uiState.update { it.copy(showSendAllConfirm = false, sendAllRecipientId = null) }
    }

    fun confirmSendAll() {
        val recipientId = _uiState.value.sendAllRecipientId ?: return
        _uiState.update { it.copy(showSendAllConfirm = false, isSending = true, error = null) }

        viewModelScope.launch {
            when (val result = economyRepository.sendEntireBackpack(recipientId)) {
                is Resource.Success -> {
                    val totalSent = (result.data["totalItemsSent"] as? Number)?.toInt() ?: 0
                    _uiState.update {
                        it.copy(
                            isSending = false,
                            sendAllRecipientId = null,
                            sentGiftName = "entire backpack ($totalSent items)"
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

    fun activateTrial() {
        _uiState.update { it.copy(isSending = true, error = null) }
        viewModelScope.launch {
            when (val result = economyRepository.activateSuperShyTrial()) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            isSending = false,
                            selectedGiftId = null,
                            sentGiftName = "Super Shy Trial activated!"
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

    fun clearNavigateToWallet() {
        _uiState.update { it.copy(navigateToWallet = false) }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
