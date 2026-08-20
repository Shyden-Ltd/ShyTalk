package com.shyden.shytalk.feature.gacha

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.CoinPackage
import com.shyden.shytalk.core.model.GachaGift
import com.shyden.shytalk.core.model.Gift
import com.shyden.shytalk.core.model.Transaction
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.GiftRepository
import com.shyden.shytalk.data.repository.UserRepository
import com.shyden.shytalk.feature.ageverification.AgeRestrictionDialogState
import com.shyden.shytalk.feature.ageverification.AgeRestrictionService
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
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
    val error: UiText? = null,
    val showResults: Boolean = false,
    val currentWin: GachaGift? = null,
    val isMultiSpin: Boolean = false,
    val multiSpinResults: List<GachaGift> = emptyList(),
    val multiSpinIndex: Int = 0,
    val coinPackages: List<CoinPackage> = emptyList(),
    val spinHistory: List<Transaction> = emptyList(),
    val pullCosts: Map<Int, Int> = emptyMap(),
    val configLoaded: Boolean = false,
    val wheelInnerThreshold: Int = 18888,
    /**
     * SHY-0372. Incremented every time a pull is refused BEFORE it starts, so
     * the wheel can leave its optimistic spinning state.
     *
     * The overlay sets `SpinPhase.ANIMATING` the instant a play button is
     * tapped, because waiting for the server would put a visible delay on every
     * spin. Its recovery used to be keyed solely on [isPulling] -- but none of
     * the refusal paths in `pull()` ever set [isPulling], so it never CHANGED,
     * the recovery never re-ran, and the wheel stayed on a spinning frame with
     * no play buttons.
     *
     * It is a COUNTER, not a flag and not the error text, because two identical
     * refusals in a row must still be two distinct signals. A flag would already
     * be set, and the same error text twice is the same value -- either way the
     * second refusal would latch the wheel exactly as before.
     */
    val pullRefusedCount: Int = 0,
)

class GachaViewModel(
    private val economyRepository: EconomyRepository,
    private val giftRepository: GiftRepository,
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository,
    private val ageRestrictionService: AgeRestrictionService,
) : ViewModel() {
    private val _uiState = MutableStateFlow(GachaUiState())
    val uiState: StateFlow<GachaUiState> = _uiState.asStateFlow()

    /**
     * State for the age-restriction dialog. The screen observes this
     * and renders [com.shyden.shytalk.feature.ageverification.AgeRestrictionDialog]
     * when non-Hidden. Set by [pull] when the current user fails the
     * 18+ gate; cleared by [dismissAgeRestrictionDialog].
     */
    private val _ageRestrictionDialogState =
        MutableStateFlow<AgeRestrictionDialogState>(AgeRestrictionDialogState.Hidden)
    val ageRestrictionDialogState: StateFlow<AgeRestrictionDialogState> =
        _ageRestrictionDialogState.asStateFlow()

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
            giftRepository
                .observeAllGifts()
                .catch { e -> _uiState.update { it.copy(error = e.message?.let { msg -> UiText.plain(msg) }) } }
                .collect { gifts ->
                    val wheelGifts = gifts.filter { g -> g.showOnWheel && g.coinValue > 0 }
                    _uiState.update {
                        it.copy(
                            giftCatalog = gifts,
                            winnableGifts = padToWheelSize(wheelGifts),
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
        private const val TAG = "GachaViewModel"
        const val WHEEL_SIZE = 16
    }

    private fun observeConfig() {
        viewModelScope.launch {
            economyRepository
                .observeEconomyConfig()
                .catch { e -> logW(TAG, "observeEconomyConfig error", e) }
                .collect { config ->
                    _uiState.update {
                        it.copy(
                            pullCosts = config.pullCosts,
                            configLoaded = config.pullCosts.isNotEmpty(),
                            wheelInnerThreshold = config.wheelInnerThreshold,
                        )
                    }
                }
        }
    }

    private fun observeBalance() {
        viewModelScope.launch {
            economyRepository
                .observeBalance()
                .catch { e -> logW(TAG, "observeBalance error", e) }
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
                else -> Unit
            }
        }
    }

    private fun loadSpinHistory(delayMs: Long = 0) {
        viewModelScope.launch {
            if (delayMs > 0) kotlinx.coroutines.delay(delayMs)
            when (val result = economyRepository.getAllTransactions("GACHA_PULL")) {
                is Resource.Success -> _uiState.update { it.copy(spinHistory = result.data) }
                else -> Unit
            }
        }
    }

    fun testPurchase(amount: Int) {
        viewModelScope.launch {
            economyRepository.addTestCoins(amount)
        }
    }

    fun updateBalance(
        coins: Long,
        pity: Int,
    ) {
        _uiState.update { it.copy(coinBalance = coins, pityCounter = pity) }
    }

    fun pullSingle() = pull(1)

    fun pullTen() = pull(10)

    fun pullHundred() = pull(100)

    /**
     * Tell the UI that a pull attempt ended without starting.
     *
     * SHY-0372. Every early return in [pull] must call this, or the wheel
     * latches on its optimistic spinning frame -- see [GachaUiState.pullRefusedCount].
     */
    private fun refusePull(error: UiText? = null) {
        _uiState.update {
            it.copy(
                // `?: it.error` and not `= error`: a refusal with no message of
                // its own must not silently clear a message already on screen.
                error = error ?: it.error,
                pullRefusedCount = it.pullRefusedCount + 1,
            )
        }
    }

    private fun pull(count: Int) {
        logI(TAG, "Gacha spin started: count=$count")
        val cost = _uiState.value.pullCosts[count]
        if (cost == null) {
            logI(TAG, "Gacha pull refused: no configured cost for tier count=$count")
            refusePull()
            return
        }
        if (_uiState.value.coinBalance < cost) {
            logI(TAG, "Gacha pull refused: insufficient coins for tier count=$count")
            refusePull(UiText.res(Res.string.error_not_enough_coins))
            return
        }
        viewModelScope.launch {
            // 18+ age-restriction gate. If the current user is sub-18 or
            // unverified-but-eligible-to-verify, surface the appropriate
            // dialog and bail BEFORE charging coins.
            //
            // A null user (anonymous, unauth, or load failure) is treated
            // as restricted — proceeding would let an attacker who pulls
            // the auth token before identity-resolve completes hit the
            // gate. UserRepository load errors are similarly fail-closed.
            val restriction = checkAgeRestriction()
            if (restriction != AgeRestrictionDialogState.Hidden) {
                _ageRestrictionDialogState.value = restriction
                logI(TAG, "Gacha pull refused by age restriction: $restriction")
                refusePull()
                return@launch
            }

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
                                error = UiText.res(Res.string.error_prices_changed),
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
                                pullCosts = latestCosts ?: it.pullCosts,
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
                                pullCosts = latestCosts ?: it.pullCosts,
                            )
                        }
                    }
                }

                is Resource.Error -> {
                    logE(TAG, "Gacha pull failed: ${result.message}")
                    _uiState.update { it.copy(isPulling = false, error = UiText.plain(result.message)) }
                }

                is Resource.Loading -> Unit
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
                showResults = true,
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
                multiSpinIndex = 0,
            )
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }

    fun dismissAgeRestrictionDialog() {
        _ageRestrictionDialogState.value = AgeRestrictionDialogState.Hidden
    }

    /**
     * Loads the current user from [userRepository] and runs the 18+
     * gate via [ageRestrictionService]. Returns the dialog state that
     * should surface — [AgeRestrictionDialogState.Hidden] when the
     * pull should proceed normally, otherwise the restriction variant
     * to show.
     *
     * Fail-closed semantics: a missing currentUserId, a Resource.Error
     * on load, or any unexpected exception returns [SubEighteen] (most
     * restrictive) rather than [Hidden]. The user can re-try once
     * sign-in completes.
     */
    private suspend fun checkAgeRestriction(): AgeRestrictionDialogState {
        val uid = authRepository.currentUserId ?: return AgeRestrictionDialogState.SubEighteen
        val user =
            when (val result = userRepository.getUser(uid)) {
                is Resource.Success -> result.data
                else -> return AgeRestrictionDialogState.SubEighteen
            }
        val state = ageRestrictionService.checkGachaAccess(user)
        return AgeRestrictionDialogState.showOnBlocked(state)
    }
}
