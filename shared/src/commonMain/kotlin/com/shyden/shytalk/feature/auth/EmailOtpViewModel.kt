package com.shyden.shytalk.feature.auth

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.DisposableEmailDomains
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.data.repository.OtpRepository
import com.shyden.shytalk.resources.*
import com.shyden.shytalk.resources.Res
import kotlinx.coroutines.Job
import kotlinx.coroutines.delay
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

enum class EmailOtpStep { EnterEmail, EnterCode }

data class EmailOtpState(
    val step: EmailOtpStep = EmailOtpStep.EnterEmail,
    val email: String = "",
    val code: String = "",
    val error: UiText? = null,
    val isLoading: Boolean = false,
    val resendCooldown: Int = 0,
    val customToken: String? = null,
)

private val EMAIL_REGEX = Regex("^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$")

class EmailOtpViewModel(
    private val otpRepository: OtpRepository,
) : ViewModel() {
    private val _state = MutableStateFlow(EmailOtpState())
    val state: StateFlow<EmailOtpState> = _state.asStateFlow()

    private var cooldownJob: Job? = null

    fun updateEmail(email: String) {
        _state.update { it.copy(email = email, error = null) }
    }

    fun updateCode(code: String) {
        if (code.length <= 6 && code.all { it.isDigit() }) {
            _state.update { it.copy(code = code, error = null) }
        }
    }

    fun sendOtp() {
        val email =
            _state.value.email
                .trim()
                .lowercase()

        if (!EMAIL_REGEX.matches(email)) {
            _state.update { it.copy(error = UiText.res(Res.string.email_invalid_address)) }
            return
        }

        val domain = email.substringAfter('@')
        if (DisposableEmailDomains.isDisposable(domain)) {
            _state.update { it.copy(error = UiText.res(Res.string.email_disposable_blocked)) }
            return
        }

        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, error = null) }

            otpRepository
                .sendOtp(email)
                .onSuccess {
                    _state.update { it.copy(isLoading = false, step = EmailOtpStep.EnterCode, email = email) }
                    startCooldown()
                }.onFailure { e ->
                    _state.update {
                        it.copy(
                            isLoading = false,
                            error = e.message?.let { msg -> UiText.plain(msg) } ?: UiText.res(Res.string.email_send_failed),
                        )
                    }
                }
        }
    }

    fun verifyOtp() {
        val code = _state.value.code
        val email = _state.value.email

        if (code.length != 6) {
            _state.update { it.copy(error = UiText.res(Res.string.email_enter_code)) }
            return
        }

        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, error = null) }

            otpRepository
                .verifyOtp(email, code)
                .onSuccess { token ->
                    _state.update { it.copy(isLoading = false, customToken = token) }
                }.onFailure { e ->
                    _state.update {
                        it.copy(
                            isLoading = false,
                            error = e.message?.let { msg -> UiText.plain(msg) } ?: UiText.res(Res.string.email_invalid_code),
                            code = "",
                        )
                    }
                }
        }
    }

    fun resendOtp() {
        if (_state.value.resendCooldown > 0) return
        sendOtpInternal()
    }

    fun goBack() {
        cooldownJob?.cancel()
        _state.update { EmailOtpState() }
    }

    private fun sendOtpInternal() {
        val email = _state.value.email
        viewModelScope.launch {
            _state.update { it.copy(isLoading = true, error = null) }
            otpRepository
                .sendOtp(email)
                .onSuccess {
                    _state.update { it.copy(isLoading = false) }
                    startCooldown()
                }.onFailure { e ->
                    _state.update {
                        it.copy(
                            isLoading = false,
                            error = e.message?.let { msg -> UiText.plain(msg) } ?: UiText.res(Res.string.email_resend_failed),
                        )
                    }
                }
        }
    }

    private fun startCooldown() {
        cooldownJob?.cancel()
        cooldownJob =
            viewModelScope.launch {
                for (i in RESEND_COOLDOWN_SECONDS downTo 1) {
                    _state.update { it.copy(resendCooldown = i) }
                    delay(1000)
                }
                _state.update { it.copy(resendCooldown = 0) }
            }
    }

    companion object {
        private const val RESEND_COOLDOWN_SECONDS = 60
    }
}
