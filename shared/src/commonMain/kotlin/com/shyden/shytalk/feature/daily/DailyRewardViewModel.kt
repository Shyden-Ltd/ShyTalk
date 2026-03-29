package com.shyden.shytalk.feature.daily

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.DailyRewardResult
import com.shyden.shytalk.core.model.MilestoneReward
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.currentTimeMillis
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.datetime.DatePeriod
import kotlinx.datetime.TimeZone
import kotlinx.datetime.minus
import kotlinx.datetime.toLocalDateTime
import kotlin.time.Instant

data class DailyRewardUiState(
    val reward: DailyRewardResult? = null,
    val hasClaimedToday: Boolean = false,
    val currentStreak: Int = 0,
    val isClaiming: Boolean = false,
    val showDialog: Boolean = false,
    val showCelebration: Boolean = false,
    val error: String? = null,
    val dailyBase: Int = 50,
    val milestoneRewards: Map<Int, MilestoneReward> = emptyMap(),
    val claimedDaysThisMonth: Set<Int> = emptySet(),
)

class DailyRewardViewModel(
    private val economyRepository: EconomyRepository,
    private val authRepository: AuthRepository,
) : ViewModel() {
    companion object {
        private const val TAG = "DailyRewardViewModel"
    }

    private val _uiState = MutableStateFlow(DailyRewardUiState())
    val uiState: StateFlow<DailyRewardUiState> = _uiState.asStateFlow()

    init {
        logI(TAG, "Initializing, observing economy config")
        observeEconomyConfig()
    }

    private fun observeEconomyConfig() {
        viewModelScope.launch {
            economyRepository.observeEconomyConfig().collect { config ->
                _uiState.update {
                    it.copy(
                        dailyBase = config.dailyBase,
                        milestoneRewards = config.milestoneRewards,
                    )
                }
            }
        }
    }

    fun checkAndShowDialog(user: User) {
        // Server stores dates in UTC (toISOString), so client must match
        val now = Instant.fromEpochMilliseconds(currentTimeMillis()).toLocalDateTime(TimeZone.UTC)
        val today = now.date.toString()
        val alreadyClaimed = user.lastLoginRewardDate == today
        logI(TAG, "Checking daily reward: alreadyClaimed=$alreadyClaimed, streak=${user.loginStreak}")

        // Estimate claimed days this month from the streak.
        // If the user has an N-day streak ending today (or yesterday if not claimed today),
        // work backwards from today to fill in which days in this month were claimed.
        val currentMonth = now.month
        val currentYear = now.year
        val streak = user.loginStreak
        val claimedDays = mutableSetOf<Int>()

        if (streak > 0) {
            val lastClaimedDate =
                if (alreadyClaimed) {
                    now.date
                } else {
                    // Streak was from yesterday
                    now.date.minus(DatePeriod(days = 1))
                }
            for (i in 0 until streak) {
                val claimedDate = lastClaimedDate.minus(DatePeriod(days = i))
                if (claimedDate.year == currentYear && claimedDate.month == currentMonth) {
                    claimedDays.add(claimedDate.day)
                }
            }
        }

        _uiState.update {
            it.copy(
                hasClaimedToday = alreadyClaimed,
                currentStreak = user.loginStreak,
                showDialog = true, // Always show — calendar visible even after claiming
                claimedDaysThisMonth = claimedDays,
            )
        }
    }

    fun claimReward() {
        logI(TAG, "Claiming daily reward")
        viewModelScope.launch {
            _uiState.update { it.copy(isClaiming = true, error = null) }
            when (val result = economyRepository.claimDailyReward()) {
                is Resource.Success -> {
                    logI(TAG, "Daily reward claimed: streak=${result.data.newStreak}, coins=${result.data.coinsAwarded}")
                    val now = Instant.fromEpochMilliseconds(currentTimeMillis()).toLocalDateTime(TimeZone.UTC)
                    val todayDay = now.day
                    _uiState.update {
                        it.copy(
                            reward = result.data,
                            hasClaimedToday = true,
                            currentStreak = result.data.newStreak,
                            isClaiming = false,
                            showDialog = false,
                            showCelebration = true,
                            claimedDaysThisMonth = it.claimedDaysThisMonth + todayDay,
                        )
                    }
                }
                is Resource.Error -> {
                    logE(TAG, "Daily reward claim failed: ${result.message}")
                    _uiState.update { it.copy(isClaiming = false, error = result.message) }
                }
                is Resource.Loading -> Unit
            }
        }
    }

    fun dismissDialog() {
        _uiState.update { it.copy(showDialog = false) }
    }

    fun dismissCelebration() {
        _uiState.update { it.copy(showCelebration = false) }
    }
}
