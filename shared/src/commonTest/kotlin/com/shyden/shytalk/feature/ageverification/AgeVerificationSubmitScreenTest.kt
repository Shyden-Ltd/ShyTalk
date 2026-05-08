package com.shyden.shytalk.feature.ageverification

import com.shyden.shytalk.data.repository.AgeVerificationRepository.IdMethod
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Pure-helper tests for the age-verification submit screen rendering decisions.
 *
 * Mirrors the project's `SuspensionScreenTest::shouldShowReason` pattern: the
 * Composable extracts a non-Composable helper for any conditional rendering
 * decision, and that helper is unit-tested at the contract layer (commonTest)
 * so the decision is pinned across all platforms (Android, iOS) without
 * needing platform-specific UI test infrastructure.
 *
 * Per the strict TDD rule (`feedback-tdd.md`): "tests come BEFORE
 * implementation; tests are the contract; 100% coverage across all applicable
 * frameworks." This file is the contract test for the non-prod simulation
 * warning that ships with the AgeVerificationSubmitScreen.
 */
class AgeVerificationSubmitScreenTest {
    // ─── shouldShowTestEnvWarning — happy path (matches both conditions) ──

    @Test
    fun `shouldShowTestEnvWarning - true when on PickImage step and isPreviewBuild`() {
        val state =
            AgeVerificationSubmitUiState(
                step = AgeVerificationSubmitStep.PickImage,
                isPreviewBuild = true,
            )
        assertTrue(shouldShowTestEnvWarning(state))
    }

    // ─── shouldShowTestEnvWarning — every other step×preview combination ──

    @Test
    fun `shouldShowTestEnvWarning - false on PickImage step when prod build`() {
        val state =
            AgeVerificationSubmitUiState(
                step = AgeVerificationSubmitStep.PickImage,
                isPreviewBuild = false,
            )
        assertFalse(shouldShowTestEnvWarning(state))
    }

    @Test
    fun `shouldShowTestEnvWarning - false on Explanation step even in preview`() {
        val state =
            AgeVerificationSubmitUiState(
                step = AgeVerificationSubmitStep.Explanation,
                isPreviewBuild = true,
            )
        assertFalse(shouldShowTestEnvWarning(state))
    }

    @Test
    fun `shouldShowTestEnvWarning - false on PickMethod step even in preview`() {
        val state =
            AgeVerificationSubmitUiState(
                step = AgeVerificationSubmitStep.PickMethod,
                isPreviewBuild = true,
            )
        assertFalse(shouldShowTestEnvWarning(state))
    }

    @Test
    fun `shouldShowTestEnvWarning - false on Confirm step even in preview`() {
        val state =
            AgeVerificationSubmitUiState(
                step = AgeVerificationSubmitStep.Confirm,
                isPreviewBuild = true,
                selectedMethod = IdMethod.Passport,
                imageBytes = byteArrayOf(0x01),
            )
        assertFalse(shouldShowTestEnvWarning(state))
    }

    @Test
    fun `shouldShowTestEnvWarning - false on Submitted step even in preview`() {
        val state =
            AgeVerificationSubmitUiState(
                step = AgeVerificationSubmitStep.Submitted,
                isPreviewBuild = true,
            )
        assertFalse(shouldShowTestEnvWarning(state))
    }

    // ─── Edge cases — default state, minimal state, with arbitrary fields ──

    @Test
    fun `shouldShowTestEnvWarning - false on default-constructed state (Explanation, prod)`() {
        // Default ctor lands on Explanation + isPreviewBuild=false. Both
        // gate conditions fail; warning is hidden. Pin this so a future
        // default-value drift can't silently flip the watermark on for
        // every prod user the moment they enter the flow.
        val state = AgeVerificationSubmitUiState()
        assertFalse(shouldShowTestEnvWarning(state))
    }

    @Test
    fun `shouldShowTestEnvWarning - independent of selectedMethod`() {
        // Verify the helper does not accidentally couple to selectedMethod
        // — only step + isPreviewBuild should matter. Use IdMethod.entries
        // (Kotlin 1.9+ replacement for the soft-deprecated values()) to
        // mirror the project's commonTest convention (e.g.
        // GachaSoundSamplesTest.kt).
        for (method in IdMethod.entries) {
            val state =
                AgeVerificationSubmitUiState(
                    step = AgeVerificationSubmitStep.PickImage,
                    isPreviewBuild = true,
                    selectedMethod = method,
                )
            assertTrue(
                shouldShowTestEnvWarning(state),
                message = "Expected warning to show for selectedMethod=$method",
            )
        }
    }

    @Test
    fun `shouldShowTestEnvWarning - independent of imageBytes presence`() {
        // Whether the image is attached or not, the warning visibility on
        // PickImage step is purely driven by isPreviewBuild.
        val withImage =
            AgeVerificationSubmitUiState(
                step = AgeVerificationSubmitStep.PickImage,
                isPreviewBuild = true,
                imageBytes = byteArrayOf(0x01, 0x02, 0x03),
            )
        val withoutImage =
            AgeVerificationSubmitUiState(
                step = AgeVerificationSubmitStep.PickImage,
                isPreviewBuild = true,
                imageBytes = null,
            )
        assertTrue(shouldShowTestEnvWarning(withImage))
        assertTrue(shouldShowTestEnvWarning(withoutImage))
    }

    @Test
    fun `shouldShowTestEnvWarning - independent of isSubmitting flag`() {
        // isSubmitting transitions PickImage->Confirm before flipping true,
        // so this case is impossible in practice — but the helper must not
        // accidentally depend on it.
        val state =
            AgeVerificationSubmitUiState(
                step = AgeVerificationSubmitStep.PickImage,
                isPreviewBuild = true,
                isSubmitting = true,
            )
        assertTrue(shouldShowTestEnvWarning(state))
    }
}
