package com.shyden.shytalk.feature.ageverification

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.BuildVariant
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.data.repository.AgeVerificationRepository
import com.shyden.shytalk.data.repository.AgeVerificationRepository.ContentType
import com.shyden.shytalk.data.repository.AgeVerificationRepository.IdMethod
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.age_verif_submit_error_generic
import com.shyden.shytalk.resources.age_verif_submit_error_no_image
import com.shyden.shytalk.resources.age_verif_submit_error_no_method
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

/**
 * Linear 4-step state machine for the user-facing verification submit
 * flow (PR 9 of the multi-PR plan).
 *
 * Transitions only go forward via the gate methods (next/back), so the
 * UI stays simple — render whatever step is current. No skipping.
 */
enum class AgeVerificationSubmitStep {
    /** "Why we need this / what happens to the image" copy. */
    Explanation,

    /** Pick passport / driver's license / national ID. */
    PickMethod,

    /** Pick image bytes (gallery — camera deferred to follow-up). */
    PickImage,

    /** Show recap + Submit. */
    Confirm,

    /** Terminal — server accepted; the user is back at sign-in. */
    Submitted,
}

data class AgeVerificationSubmitUiState(
    val step: AgeVerificationSubmitStep = AgeVerificationSubmitStep.Explanation,
    val selectedMethod: IdMethod? = null,
    val imageBytes: ByteArray? = null,
    /** Detected content type. Present only after [setImage]. */
    val imageContentType: ContentType? = null,
    val isSubmitting: Boolean = false,
    val error: UiText? = null,
    /**
     * `true` on local + dev builds — drives the prominent
     * "test environment, do not upload a real ID" warning on the
     * PickImage step (spec `.project/plans/2026-05-03-age-verification.md`
     * Non-prod simulation).
     */
    val isPreviewBuild: Boolean = false,
) {
    /**
     * Custom equals to compare by reference / size for [imageBytes] —
     * deep array equality is expensive and we only need state-change
     * detection for Compose recomposition.
     */
    override fun equals(other: Any?): Boolean {
        if (this === other) return true
        if (other !is AgeVerificationSubmitUiState) return false
        return step == other.step &&
            selectedMethod == other.selectedMethod &&
            imageBytes === other.imageBytes &&
            imageContentType == other.imageContentType &&
            isSubmitting == other.isSubmitting &&
            error == other.error &&
            isPreviewBuild == other.isPreviewBuild
    }

    override fun hashCode(): Int {
        var result = step.hashCode()
        result = 31 * result + (selectedMethod?.hashCode() ?: 0)
        result = 31 * result + (imageBytes?.size ?: 0)
        result = 31 * result + (imageContentType?.hashCode() ?: 0)
        result = 31 * result + isSubmitting.hashCode()
        result = 31 * result + (error?.hashCode() ?: 0)
        result = 31 * result + isPreviewBuild.hashCode()
        return result
    }
}

class AgeVerificationSubmitViewModel(
    private val repository: AgeVerificationRepository,
    isPreviewBuild: Boolean = BuildVariant.isPreviewBuild,
) : ViewModel() {
    companion object {
        private const val TAG = "AgeVerifSubmitVM"
    }

    private val _uiState = MutableStateFlow(AgeVerificationSubmitUiState(isPreviewBuild = isPreviewBuild))
    val uiState: StateFlow<AgeVerificationSubmitUiState> = _uiState.asStateFlow()

    /**
     * Advance past the explanation step. No validation — the user just
     * acknowledged the copy.
     */
    fun acknowledgeExplanation() {
        if (_uiState.value.step == AgeVerificationSubmitStep.Explanation) {
            _uiState.update { it.copy(step = AgeVerificationSubmitStep.PickMethod, error = null) }
        }
    }

    /**
     * Lock in the picked ID method and advance to image picking.
     * Re-pickable until the user confirms (back button reverts here).
     */
    fun selectMethod(method: IdMethod) {
        _uiState.update {
            it.copy(
                step = AgeVerificationSubmitStep.PickImage,
                selectedMethod = method,
                error = null,
            )
        }
    }

    /**
     * Store the picked image bytes + detected content type and advance
     * to the Confirm step. Caller is responsible for sniffing the
     * content type from the platform picker (JPEG is the default but
     * iOS PHPicker can return PNG / WebP).
     */
    fun setImage(
        bytes: ByteArray,
        contentType: ContentType,
    ) {
        _uiState.update {
            it.copy(
                step = AgeVerificationSubmitStep.Confirm,
                imageBytes = bytes,
                imageContentType = contentType,
                error = null,
            )
        }
    }

    /**
     * Step back one. The Confirm step backs to PickImage so the user
     * can swap the photo without re-picking the method. PickImage
     * backs to PickMethod. PickMethod backs to Explanation. Explanation
     * is a no-op — the screen-level back handler should pop navigation.
     */
    fun back() {
        _uiState.update {
            when (it.step) {
                AgeVerificationSubmitStep.Confirm ->
                    it.copy(step = AgeVerificationSubmitStep.PickImage, error = null)

                AgeVerificationSubmitStep.PickImage ->
                    it.copy(step = AgeVerificationSubmitStep.PickMethod, error = null)

                AgeVerificationSubmitStep.PickMethod ->
                    it.copy(step = AgeVerificationSubmitStep.Explanation, error = null)

                AgeVerificationSubmitStep.Explanation,
                AgeVerificationSubmitStep.Submitted,
                -> it
            }
        }
    }

    /**
     * Final action — runs the 3-call submit flow inside the VM scope.
     * Sets [AgeVerificationSubmitUiState.isSubmitting] to true while
     * any of the calls is in flight so the UI can disable the button.
     *
     * On success, transitions to [AgeVerificationSubmitStep.Submitted]
     * and the screen is expected to navigate away (back to the
     * pending-state UI / home).
     *
     * On failure, sets an error UiText and stays on the Confirm step
     * so the user can retry.
     */
    fun submit() {
        val state = _uiState.value
        val method = state.selectedMethod
        val bytes = state.imageBytes
        val contentType = state.imageContentType
        if (method == null) {
            _uiState.update { it.copy(error = UiText.Res(Res.string.age_verif_submit_error_no_method)) }
            return
        }
        if (bytes == null || contentType == null) {
            _uiState.update { it.copy(error = UiText.Res(Res.string.age_verif_submit_error_no_image)) }
            return
        }
        _uiState.update { it.copy(isSubmitting = true, error = null) }

        viewModelScope.launch {
            val handle =
                when (val r = repository.requestUploadUrl(contentType)) {
                    is Resource.Success -> r.data

                    is Resource.Error -> {
                        logE(TAG, "Upload-URL failed: ${r.message}")
                        _uiState.update {
                            it.copy(
                                isSubmitting = false,
                                error = UiText.Res(Res.string.age_verif_submit_error_generic),
                            )
                        }
                        return@launch
                    }

                    is Resource.Loading -> return@launch
                }

            when (val r = repository.uploadImage(handle.uploadUrl, contentType, bytes)) {
                is Resource.Success -> Unit

                is Resource.Error -> {
                    logE(TAG, "R2 PUT failed: ${r.message}")
                    _uiState.update {
                        it.copy(
                            isSubmitting = false,
                            error = UiText.Res(Res.string.age_verif_submit_error_generic),
                        )
                    }
                    return@launch
                }

                is Resource.Loading -> return@launch
            }

            when (val r = repository.submit(method, handle.r2Key)) {
                is Resource.Success -> {
                    logI(TAG, "Submission accepted, transitioning to Submitted")
                    _uiState.update {
                        it.copy(
                            step = AgeVerificationSubmitStep.Submitted,
                            isSubmitting = false,
                        )
                    }
                }

                is Resource.Error -> {
                    logE(TAG, "Submit failed: ${r.message}")
                    _uiState.update {
                        it.copy(
                            isSubmitting = false,
                            error = UiText.Res(Res.string.age_verif_submit_error_generic),
                        )
                    }
                }

                is Resource.Loading -> Unit
            }
        }
    }

    fun clearError() {
        _uiState.update { it.copy(error = null) }
    }
}
