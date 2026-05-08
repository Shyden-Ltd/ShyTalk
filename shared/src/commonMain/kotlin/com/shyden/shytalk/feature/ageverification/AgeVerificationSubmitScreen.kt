package com.shyden.shytalk.feature.ageverification

import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Arrangement
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.Spacer
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.height
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.layout.width
import androidx.compose.foundation.shape.CircleShape
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material.icons.Icons
import androidx.compose.material.icons.automirrored.filled.ArrowBack
import androidx.compose.material3.Button
import androidx.compose.material3.CircularProgressIndicator
import androidx.compose.material3.ExperimentalMaterial3Api
import androidx.compose.material3.Icon
import androidx.compose.material3.IconButton
import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.OutlinedButton
import androidx.compose.material3.Scaffold
import androidx.compose.material3.Text
import androidx.compose.material3.TopAppBar
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.text.font.FontWeight
import androidx.compose.ui.unit.dp
import androidx.lifecycle.compose.collectAsStateWithLifecycle
import com.shyden.shytalk.core.platform.PlatformImagePicker
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.data.repository.AgeVerificationRepository.ContentType
import com.shyden.shytalk.data.repository.AgeVerificationRepository.IdMethod
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.age_verif_back
import com.shyden.shytalk.resources.age_verif_field_method
import com.shyden.shytalk.resources.age_verif_field_photo
import com.shyden.shytalk.resources.age_verif_method_drivers_license
import com.shyden.shytalk.resources.age_verif_method_national_id
import com.shyden.shytalk.resources.age_verif_method_passport
import com.shyden.shytalk.resources.age_verif_photo_attached
import com.shyden.shytalk.resources.age_verif_step_confirm_body
import com.shyden.shytalk.resources.age_verif_step_confirm_submit
import com.shyden.shytalk.resources.age_verif_step_confirm_title
import com.shyden.shytalk.resources.age_verif_step_explanation_body
import com.shyden.shytalk.resources.age_verif_step_explanation_continue
import com.shyden.shytalk.resources.age_verif_step_explanation_title
import com.shyden.shytalk.resources.age_verif_step_image_body
import com.shyden.shytalk.resources.age_verif_step_image_pick
import com.shyden.shytalk.resources.age_verif_step_image_replace
import com.shyden.shytalk.resources.age_verif_step_image_title
import com.shyden.shytalk.resources.age_verif_step_method_body
import com.shyden.shytalk.resources.age_verif_step_method_title
import com.shyden.shytalk.resources.age_verif_step_submitted_body
import com.shyden.shytalk.resources.age_verif_step_submitted_done
import com.shyden.shytalk.resources.age_verif_step_submitted_title
import com.shyden.shytalk.resources.age_verif_submit_title
import com.shyden.shytalk.resources.age_verif_test_env_label
import com.shyden.shytalk.resources.age_verif_test_env_warning
import org.jetbrains.compose.resources.stringResource
import org.koin.compose.viewmodel.koinViewModel

const val TAG_AGE_VERIF_CONTINUE = "ageVerif_continue"
const val TAG_AGE_VERIF_METHOD_PASSPORT = "ageVerif_method_passport"
const val TAG_AGE_VERIF_METHOD_DRIVERS = "ageVerif_method_drivers"
const val TAG_AGE_VERIF_METHOD_NATIONAL = "ageVerif_method_national"
const val TAG_AGE_VERIF_PICK_IMAGE = "ageVerif_pickImage"
const val TAG_AGE_VERIF_SUBMIT = "ageVerif_submit"
const val TAG_AGE_VERIF_DONE = "ageVerif_done"
const val TAG_AGE_VERIF_BACK = "ageVerif_back"
const val TAG_AGE_VERIF_TEST_ENV_WARNING = "ageVerif_testEnvWarning"

/**
 * 4-step user-facing verification flow (PR 9).
 *
 * State machine in [AgeVerificationSubmitViewModel] drives which step
 * renders. Navigation pop happens when:
 *  - user hits the back button on the Explanation step (which is a
 *    no-op in the VM — the screen interprets it as "exit"), OR
 *  - user lands on Submitted and hits Done.
 */
@OptIn(ExperimentalMaterial3Api::class)
@Composable
fun AgeVerificationSubmitScreen(
    onClose: () -> Unit,
    viewModel: AgeVerificationSubmitViewModel = koinViewModel(),
) {
    val uiState by viewModel.uiState.collectAsStateWithLifecycle()

    Scaffold(
        topBar = {
            TopAppBar(
                title = { Text(stringResource(Res.string.age_verif_submit_title)) },
                navigationIcon = {
                    IconButton(
                        onClick = {
                            // Map "back from Explanation / Submitted" to a screen-pop.
                            // Other steps step backwards through the VM state machine.
                            when (uiState.step) {
                                AgeVerificationSubmitStep.Explanation -> onClose()
                                AgeVerificationSubmitStep.Submitted -> onClose()
                                else -> viewModel.back()
                            }
                        },
                        modifier = Modifier.testTag(TAG_AGE_VERIF_BACK),
                    ) {
                        Icon(
                            Icons.AutoMirrored.Filled.ArrowBack,
                            contentDescription = stringResource(Res.string.age_verif_back),
                        )
                    }
                },
            )
        },
    ) { padding ->
        Box(
            modifier =
                Modifier
                    .fillMaxSize()
                    .padding(padding)
                    .padding(horizontal = 24.dp, vertical = 16.dp),
        ) {
            when (uiState.step) {
                AgeVerificationSubmitStep.Explanation -> ExplanationStep(viewModel::acknowledgeExplanation)

                AgeVerificationSubmitStep.PickMethod -> PickMethodStep(viewModel::selectMethod)

                AgeVerificationSubmitStep.PickImage ->
                    PickImageStep(
                        photoAlreadyAttached = uiState.imageBytes != null,
                        showTestEnvWarning = uiState.isPreviewBuild,
                    ) { bytes, ct ->
                        viewModel.setImage(bytes, ct)
                    }

                AgeVerificationSubmitStep.Confirm ->
                    ConfirmStep(
                        method = uiState.selectedMethod,
                        photoAttached = uiState.imageBytes != null,
                        isSubmitting = uiState.isSubmitting,
                        error = uiState.error,
                        onSubmit = viewModel::submit,
                    )

                AgeVerificationSubmitStep.Submitted -> SubmittedStep(onClose)
            }
        }
    }
}

@Composable
private fun ExplanationStep(onContinue: () -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(
            stringResource(Res.string.age_verif_step_explanation_title),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Text(
            stringResource(Res.string.age_verif_step_explanation_body),
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = onContinue,
            modifier = Modifier.fillMaxWidth().testTag(TAG_AGE_VERIF_CONTINUE),
        ) {
            Text(stringResource(Res.string.age_verif_step_explanation_continue))
        }
    }
}

@Composable
private fun PickMethodStep(onMethodSelected: (IdMethod) -> Unit) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(
            stringResource(Res.string.age_verif_step_method_title),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Text(
            stringResource(Res.string.age_verif_step_method_body),
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(4.dp))
        OutlinedButton(
            onClick = { onMethodSelected(IdMethod.Passport) },
            modifier = Modifier.fillMaxWidth().testTag(TAG_AGE_VERIF_METHOD_PASSPORT),
        ) {
            Text(stringResource(Res.string.age_verif_method_passport))
        }
        OutlinedButton(
            onClick = { onMethodSelected(IdMethod.DriversLicense) },
            modifier = Modifier.fillMaxWidth().testTag(TAG_AGE_VERIF_METHOD_DRIVERS),
        ) {
            Text(stringResource(Res.string.age_verif_method_drivers_license))
        }
        OutlinedButton(
            onClick = { onMethodSelected(IdMethod.NationalId) },
            modifier = Modifier.fillMaxWidth().testTag(TAG_AGE_VERIF_METHOD_NATIONAL),
        ) {
            Text(stringResource(Res.string.age_verif_method_national_id))
        }
    }
}

@Composable
private fun PickImageStep(
    photoAlreadyAttached: Boolean,
    showTestEnvWarning: Boolean,
    onImagePicked: (ByteArray, ContentType) -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(16.dp)) {
        Text(
            stringResource(Res.string.age_verif_step_image_title),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Text(
            stringResource(Res.string.age_verif_step_image_body),
            style = MaterialTheme.typography.bodyMedium,
        )
        if (showTestEnvWarning) {
            TestEnvironmentWarning()
        }
        Spacer(Modifier.height(4.dp))
        // PlatformImagePicker emits JPEG bytes via the gallery picker.
        // Camera support is a follow-up — the existing
        // ActivityResultContracts.PickVisualMedia path is gallery-only.
        // Treat all picked bytes as image/jpeg for now; the upload-url
        // endpoint accepts that content type and the user uploaded
        // through the system picker so it should be a real image.
        PlatformImagePicker(
            onImageSelected = { bytes ->
                if (bytes != null && bytes.isNotEmpty()) {
                    onImagePicked(bytes, ContentType.Jpeg)
                }
            },
        ) { launchPicker ->
            Button(
                onClick = launchPicker,
                modifier = Modifier.fillMaxWidth().testTag(TAG_AGE_VERIF_PICK_IMAGE),
            ) {
                Text(
                    stringResource(
                        if (photoAlreadyAttached) {
                            Res.string.age_verif_step_image_replace
                        } else {
                            Res.string.age_verif_step_image_pick
                        },
                    ),
                )
            }
        }
    }
}

@Composable
private fun ConfirmStep(
    method: IdMethod?,
    photoAttached: Boolean,
    isSubmitting: Boolean,
    error: UiText?,
    onSubmit: () -> Unit,
) {
    Column(verticalArrangement = Arrangement.spacedBy(12.dp)) {
        Text(
            stringResource(Res.string.age_verif_step_confirm_title),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Text(
            stringResource(Res.string.age_verif_step_confirm_body),
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(4.dp))
        Row(
            label = stringResource(Res.string.age_verif_field_method),
            value = method?.let { stringResource(it.labelRes()) } ?: "—",
        )
        Row(
            label = stringResource(Res.string.age_verif_field_photo),
            value = if (photoAttached) stringResource(Res.string.age_verif_photo_attached) else "—",
        )
        Spacer(Modifier.height(4.dp))
        if (error != null) {
            Text(
                error.resolve(),
                color = MaterialTheme.colorScheme.error,
                style = MaterialTheme.typography.bodySmall,
            )
        }
        Button(
            onClick = onSubmit,
            enabled = !isSubmitting,
            modifier = Modifier.fillMaxWidth().testTag(TAG_AGE_VERIF_SUBMIT),
        ) {
            if (isSubmitting) {
                CircularProgressIndicator(
                    modifier = Modifier.height(20.dp).width(20.dp),
                    color = MaterialTheme.colorScheme.onPrimary,
                    strokeWidth = 2.dp,
                )
            } else {
                Text(stringResource(Res.string.age_verif_step_confirm_submit))
            }
        }
    }
}

@Composable
private fun SubmittedStep(onDone: () -> Unit) {
    Column(
        verticalArrangement = Arrangement.spacedBy(16.dp),
        horizontalAlignment = Alignment.CenterHorizontally,
        modifier = Modifier.fillMaxWidth(),
    ) {
        Box(
            modifier =
                Modifier
                    .height(64.dp)
                    .width(64.dp)
                    .background(MaterialTheme.colorScheme.primaryContainer, CircleShape),
        )
        Text(
            stringResource(Res.string.age_verif_step_submitted_title),
            style = MaterialTheme.typography.headlineSmall,
            fontWeight = FontWeight.Bold,
        )
        Text(
            stringResource(Res.string.age_verif_step_submitted_body),
            style = MaterialTheme.typography.bodyMedium,
        )
        Spacer(Modifier.height(8.dp))
        Button(
            onClick = onDone,
            modifier = Modifier.fillMaxWidth().testTag(TAG_AGE_VERIF_DONE),
        ) {
            Text(stringResource(Res.string.age_verif_step_submitted_done))
        }
    }
}

/**
 * Prominent banner shown above the image picker on local + dev builds
 * (driven by [AgeVerificationSubmitUiState.isPreviewBuild]). Reassures
 * the tester not to upload a real ID — the spec rule is that non-prod
 * environments simulate the flow without long-term retention of PII
 * (`.project/plans/2026-05-03-age-verification.md` → "Non-prod
 * simulation").
 */
@Composable
private fun TestEnvironmentWarning() {
    Column(
        modifier =
            Modifier
                .fillMaxWidth()
                .testTag(TAG_AGE_VERIF_TEST_ENV_WARNING)
                .background(
                    MaterialTheme.colorScheme.tertiaryContainer,
                    RoundedCornerShape(8.dp),
                ).padding(horizontal = 12.dp, vertical = 10.dp),
        verticalArrangement = Arrangement.spacedBy(4.dp),
    ) {
        Text(
            stringResource(Res.string.age_verif_test_env_label),
            color = MaterialTheme.colorScheme.onTertiaryContainer,
            style = MaterialTheme.typography.labelMedium,
            fontWeight = FontWeight.Bold,
        )
        Text(
            stringResource(Res.string.age_verif_test_env_warning),
            color = MaterialTheme.colorScheme.onTertiaryContainer,
            style = MaterialTheme.typography.bodySmall,
        )
    }
}

@Composable
private fun Row(
    label: String,
    value: String,
) {
    androidx.compose.foundation.layout.Row(
        modifier =
            Modifier
                .fillMaxWidth()
                .background(MaterialTheme.colorScheme.surfaceVariant, RoundedCornerShape(8.dp))
                .padding(horizontal = 12.dp, vertical = 8.dp),
        verticalAlignment = Alignment.CenterVertically,
        horizontalArrangement = Arrangement.SpaceBetween,
    ) {
        Text(label, style = MaterialTheme.typography.bodySmall)
        Text(value, style = MaterialTheme.typography.bodyMedium, fontWeight = FontWeight.Medium)
    }
}

private fun IdMethod.labelRes() =
    when (this) {
        IdMethod.Passport -> Res.string.age_verif_method_passport
        IdMethod.DriversLicense -> Res.string.age_verif_method_drivers_license
        IdMethod.NationalId -> Res.string.age_verif_method_national_id
    }
