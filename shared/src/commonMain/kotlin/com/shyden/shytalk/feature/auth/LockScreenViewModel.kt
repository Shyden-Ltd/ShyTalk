package com.shyden.shytalk.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.BiometricAuth
import com.shyden.shytalk.core.util.BiometricResult
import com.shyden.shytalk.core.util.CryptoKeyPair
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.data.repository.AppLockRepository
import com.shyden.shytalk.data.repository.BiometricRepository
import com.shyden.shytalk.data.repository.PinRepository
import com.shyden.shytalk.data.repository.PinVerifyResult
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch
import org.jetbrains.compose.resources.getString
import kotlin.io.encoding.Base64
import kotlin.io.encoding.ExperimentalEncodingApi

data class LockScreenState(
    val pinInput: String = "",
    val error: UiText? = null,
    val isLoading: Boolean = false,
    val isLocked: Boolean = false,
    val lockedUntil: Long? = null,
    val requiresReauth: Boolean = false,
    val attemptsRemaining: Int = 5,
    val unlocked: Boolean = false,
    val biometricAvailable: Boolean = false,
)

class LockScreenViewModel(
    private val pinRepository: PinRepository,
    private val biometricRepository: BiometricRepository,
    private val biometricAuth: BiometricAuth,
    private val cryptoKeyPair: CryptoKeyPair,
    private val appLockRepository: AppLockRepository,
) : ViewModel() {
    private val _state =
        MutableStateFlow(
            LockScreenState(
                biometricAvailable = biometricAuth.isAvailable() && appLockRepository.isBiometricEnabled,
            ),
        )
    val state: StateFlow<LockScreenState> = _state.asStateFlow()

    private var lockoutTimestamp: Long? = null

    /** Set by the screen/activity to handle lockout consequences (voice disconnect, notification suppression). */
    var onLockout: (() -> Unit)? = null

    /** Set by the screen/activity to undo lockout consequences (biometric grace period). */
    var onLockoutRecovered: (() -> Unit)? = null

    fun onPinDigit(digit: Char) {
        _state.update { it.copy(pinInput = it.pinInput + digit, error = null) }
    }

    fun onPinBackspace() {
        _state.update {
            if (it.pinInput.isNotEmpty()) {
                it.copy(pinInput = it.pinInput.dropLast(1))
            } else {
                it
            }
        }
    }

    fun onPinClear() {
        _state.update { it.copy(pinInput = "", error = null) }
    }

    fun submitPin() {
        val pin = _state.value.pinInput
        if (pin.length < 4) {
            _state.update { it.copy(error = UiText.res(Res.string.pin_too_short)) }
            return
        }

        val uniqueId = appLockRepository.storedUniqueId
        val deviceId = appLockRepository.storedDeviceId
        if (uniqueId == null || deviceId == null) {
            _state.update { it.copy(error = UiText.res(Res.string.pin_session_expired), requiresReauth = true) }
            return
        }

        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, error = null) }

            val result = pinRepository.verifyPin(uniqueId, deviceId, pin)
            result
                .onSuccess { verifyResult ->
                    handlePinResult(verifyResult)
                }.onFailure { e ->
                    _state.update {
                        it.copy(
                            isLoading = false,
                            error = e.message?.let { msg -> UiText.plain(msg) } ?: UiText.res(Res.string.pin_verify_failed),
                        )
                    }
                }
        }
    }

    private fun handlePinResult(result: PinVerifyResult) {
        if (result.customToken != null) {
            checkBiometricGracePeriod()
            _state.update { it.copy(isLoading = false, unlocked = true, pinInput = "") }
        } else if (result.locked) {
            lockoutTimestamp = epochMillis()
            onLockout?.invoke()
            _state.update {
                it.copy(
                    isLoading = false,
                    isLocked = true,
                    lockedUntil = result.lockedUntil,
                    requiresReauth = result.requiresReauth,
                    attemptsRemaining = 0,
                    pinInput = "",
                    error = null,
                )
            }
        } else {
            _state.update {
                it.copy(
                    isLoading = false,
                    attemptsRemaining = result.attemptsRemaining,
                    pinInput = "",
                    error = UiText.res(Res.string.pin_wrong_attempts, result.attemptsRemaining),
                )
            }
        }
    }

    @OptIn(ExperimentalEncodingApi::class)
    fun authenticateWithBiometric() {
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, error = null) }

            val bioTitle = getString(Res.string.biometric_unlock_title)
            val bioDesc = getString(Res.string.biometric_unlock_desc)
            when (val bioResult = biometricAuth.authenticate(bioTitle, bioDesc)) {
                is BiometricResult.Success -> {
                    val uniqueId = appLockRepository.storedUniqueId
                    val deviceId = appLockRepository.storedDeviceId
                    if (uniqueId == null || deviceId == null) {
                        _state.update {
                            it.copy(
                                isLoading = false,
                                error = UiText.res(Res.string.pin_session_expired),
                                requiresReauth = true,
                            )
                        }
                        return@launch
                    }

                    val challengeResult = biometricRepository.getChallenge(uniqueId, deviceId)
                    challengeResult
                        .onSuccess { nonce ->
                            val signatureBytes = cryptoKeyPair.sign(nonce.encodeToByteArray())
                            if (signatureBytes == null) {
                                _state.update { it.copy(isLoading = false, error = UiText.res(Res.string.biometric_sign_failed)) }
                                return@launch
                            }
                            val signatureBase64 = Base64.encode(signatureBytes)
                            val verifyResult = biometricRepository.verify(uniqueId, deviceId, signatureBase64)
                            verifyResult
                                .onSuccess {
                                    checkBiometricGracePeriod()
                                    _state.update { it.copy(isLoading = false, unlocked = true) }
                                }.onFailure { e ->
                                    _state.update {
                                        it.copy(
                                            isLoading = false,
                                            error =
                                                e.message?.let { msg -> UiText.plain(msg) }
                                                    ?: UiText.res(Res.string.biometric_verify_failed),
                                        )
                                    }
                                }
                        }.onFailure { e ->
                            _state.update {
                                it.copy(
                                    isLoading = false,
                                    error = e.message?.let { msg -> UiText.plain(msg) } ?: UiText.res(Res.string.biometric_start_failed),
                                )
                            }
                        }
                }
                is BiometricResult.Fallback -> {
                    _state.update { it.copy(isLoading = false) }
                }
                is BiometricResult.Error -> {
                    _state.update { it.copy(isLoading = false, error = bioResult.message?.let { msg -> UiText.plain(msg) }) }
                }
            }
        }
    }

    private fun checkBiometricGracePeriod() {
        val ts = lockoutTimestamp ?: return
        if (epochMillis() - ts < BIOMETRIC_GRACE_PERIOD_MS) {
            onLockoutRecovered?.invoke()
        }
    }

    /** KMP-safe epoch millis using the platform expect/actual function. */
    private fun epochMillis(): Long =
        com.shyden.shytalk.core.util
            .currentTimeMillis()

    companion object {
        private const val BIOMETRIC_GRACE_PERIOD_MS = 10_000L
    }
}
