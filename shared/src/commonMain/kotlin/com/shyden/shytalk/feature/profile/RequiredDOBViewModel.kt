package com.shyden.shytalk.feature.profile

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository
import com.shyden.shytalk.data.repository.UserRepository
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

data class RequiredDOBUiState(
    val isLoading: Boolean = false,
    val error: String? = null,
    val saved: Boolean = false
)

class RequiredDOBViewModel(
    private val authRepository: AuthRepository,
    private val userRepository: UserRepository
) : ViewModel() {

    private val _uiState = MutableStateFlow(RequiredDOBUiState())
    val uiState: StateFlow<RequiredDOBUiState> = _uiState.asStateFlow()

    fun saveDateOfBirth(dateOfBirthMillis: Long) {
        val userId = authRepository.currentUserId ?: return
        viewModelScope.launch {
            _uiState.update { it.copy(isLoading = true, error = null) }
            when (userRepository.updateProfile(userId, mapOf("dateOfBirth" to dateOfBirthMillis))) {
                is Resource.Success -> {
                    _uiState.update { it.copy(isLoading = false, saved = true) }
                }
                is Resource.Error -> {
                    _uiState.update { it.copy(isLoading = false, error = "Failed to save date of birth") }
                }
                is Resource.Loading -> {}
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
