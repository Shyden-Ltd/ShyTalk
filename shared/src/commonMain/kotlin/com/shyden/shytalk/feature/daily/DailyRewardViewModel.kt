package com.shyden.shytalk.feature.daily

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.model.DailyRewardResult
import com.shyden.shytalk.core.model.User
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.EconomyRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import kotlinx.datetime.Clock
import kotlinx.datetime.TimeZone
import kotlinx.datetime.toLocalDateTime

data class DailyRewardUiState(
    val reward: DailyRewardResult? = null,
    val hasClaimedToday: Boolean = false,
    val currentStreak: Int = 0,
    val isClaiming: Boolean = false,
    val showDialog: Boolean = false,
    val error: String? = null
)

class DailyRewardViewModel(
    private val economyRepository: EconomyRepository,
    private val authRepository: AuthRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(DailyRewardUiState())
    val uiState: StateFlow<DailyRewardUiState> = _uiState.asStateFlow()

    fun checkAndShowDialog(user: User) {
        val today = Clock.System.now()
            .toLocalDateTime(TimeZone.currentSystemDefault())
            .date.toString()
        val alreadyClaimed = user.lastLoginRewardDate == today
        _uiState.update {
            it.copy(
                hasClaimedToday = alreadyClaimed,
                currentStreak = user.loginStreak,
                showDialog = !alreadyClaimed
            )
        }
    }

    fun claimReward() {
        viewModelScope.launch {
            _uiState.update { it.copy(isClaiming = true, error = null) }
            when (val result = economyRepository.claimDailyReward()) {
                is Resource.Success -> {
                    _uiState.update {
                        it.copy(
                            reward = result.data,
                            hasClaimedToday = true,
                            currentStreak = result.data.newStreak,
                            isClaiming = false
                        )
                    }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isClaiming = false, error = result.message) }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun dismissDialog() {
        _uiState.update { it.copy(showDialog = false) }
    }
}
