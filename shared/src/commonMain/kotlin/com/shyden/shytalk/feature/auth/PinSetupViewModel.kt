package com.shyden.shytalk.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.data.repository.AppLockRepository
import com.shyden.shytalk.data.repository.PinRepository
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class PinSetupStep { ChooseLength, Enter, Confirm }

data class PinSetupState(
    val step: PinSetupStep = PinSetupStep.ChooseLength,
    val pinLength: Int = 4,
    val pinInput: String = "",
    val firstPin: String = "",
    val error: UiText? = null,
    val isLoading: Boolean = false,
    val completed: Boolean = false,
    val showBiometricOffer: Boolean = false,
)

class PinSetupViewModel(
    private val pinRepository: PinRepository,
    private val appLockRepository: AppLockRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(PinSetupState())
    val state: StateFlow<PinSetupState> = _state.asStateFlow()

    fun selectPinLength(length: Int) {
        if (length < 4 || length > 8) return
        _state.update { it.copy(pinLength = length, step = PinSetupStep.Enter, error = null) }
    }

    fun onDigit(digit: Char) {
        val current = _state.value
        if (current.pinInput.length >= current.pinLength) return
        _state.update { it.copy(pinInput = it.pinInput + digit, error = null) }
    }

    fun onBackspace() {
        _state.update {
            if (it.pinInput.isNotEmpty()) {
                it.copy(pinInput = it.pinInput.dropLast(1))
            } else {
                it
            }
        }
    }

    fun submit() {
        val current = _state.value
        val pin = current.pinInput

        if (pin.length != current.pinLength) {
            _state.update { it.copy(error = UiText.res(Res.string.pin_enter_digits, current.pinLength)) }
            return
        }

        when (current.step) {
            PinSetupStep.ChooseLength -> {} // shouldn't happen
            PinSetupStep.Enter -> {
                _state.update { it.copy(step = PinSetupStep.Confirm, firstPin = pin, pinInput = "", error = null) }
            }
            PinSetupStep.Confirm -> {
                if (pin != current.firstPin) {
                    _state.update {
                        it.copy(
                            step = PinSetupStep.Enter,
                            pinInput = "",
                            firstPin = "",
                            error = UiText.res(Res.string.pin_mismatch),
                        )
                    }
                    return
                }
                savePinToServer(pin)
            }
        }
    }

    private fun savePinToServer(pin: String) {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, error = null) }

            pinRepository
                .setupPin(pin)
                .onSuccess { pinHash ->
                    // Store bcrypt hash locally for offline PIN verification
                    val uniqueId = appLockRepository.storedUniqueId
                    val deviceId = appLockRepository.storedDeviceId
                    if (uniqueId.isNullOrEmpty() || deviceId.isNullOrEmpty()) {
                        _state.update { it.copy(isLoading = false, error = UiText.res(Res.string.pin_device_not_registered)) }
                        return@onSuccess
                    }
                    appLockRepository.setCredential(uniqueId, deviceId, pinHash)
                    _state.update { it.copy(isLoading = false, showBiometricOffer = true) }
                }.onFailure { e ->
                    _state.update {
                        it.copy(
                            isLoading = false,
                            error = e.message?.let { msg -> UiText.plain(msg) } ?: UiText.res(Res.string.pin_setup_failed),
                        )
                    }
                }
        }
    }

    fun onBiometricAccepted() {
        appLockRepository.setBiometricEnabled(true)
        _state.update { it.copy(showBiometricOffer = false, completed = true) }
    }

    fun onBiometricDeclined() {
        appLockRepository.setBiometricEnabled(false)
        _state.update { it.copy(showBiometricOffer = false, completed = true) }
    }

    fun reset() {
        _state.update { PinSetupState() }
    }
}
