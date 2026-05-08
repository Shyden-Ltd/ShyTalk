package com.shyden.shytalk.feature.ageverification

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AgeVerificationRepository
import com.shyden.shytalk.data.repository.AgeVerificationRepository.ContentType
import com.shyden.shytalk.data.repository.AgeVerificationRepository.IdMethod
import com.shyden.shytalk.data.repository.AgeVerificationRepository.UploadHandle
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.ExperimentalCoroutinesApi
import kotlinx.coroutines.test.StandardTestDispatcher
import kotlinx.coroutines.test.advanceUntilIdle
import kotlinx.coroutines.test.resetMain
import kotlinx.coroutines.test.runTest
import kotlinx.coroutines.test.setMain
import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Tests for the user-facing age-verification submit flow ViewModel
 * (PR 9). Pin the state-machine transitions, the back-button rules,
 * and the failure paths through the 3-call submit sequence.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class AgeVerificationSubmitViewModelTest {
    private val testDispatcher = StandardTestDispatcher()
    private lateinit var repo: FakeAgeVerificationRepository
    private lateinit var viewModel: AgeVerificationSubmitViewModel

    @BeforeTest
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        repo = FakeAgeVerificationRepository()
        viewModel = AgeVerificationSubmitViewModel(repo, isPreviewBuild = false)
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // ─── Initial state ──────────────────────────────────────────

    @Test
    fun `initial state is Explanation step`() {
        assertEquals(AgeVerificationSubmitStep.Explanation, viewModel.uiState.value.step)
        assertNull(viewModel.uiState.value.selectedMethod)
        assertNull(viewModel.uiState.value.imageBytes)
        assertFalse(viewModel.uiState.value.isSubmitting)
        assertNull(viewModel.uiState.value.error)
    }

    // ─── Non-prod simulation warning flag ───────────────────────
    //
    // Spec (`.project/plans/2026-05-03-age-verification.md` Non-prod
    // simulation): on local + dev builds the user must be prominently
    // warned not to upload a real ID. Surfacing the flag through UI
    // state so the screen renders the warning conditionally without
    // each call site needing to know about BuildVariant.

    @Test
    fun `isPreviewBuild=true is exposed via uiState from initial state`() {
        val previewVm = AgeVerificationSubmitViewModel(repo, isPreviewBuild = true)
        assertTrue(previewVm.uiState.value.isPreviewBuild)
    }

    @Test
    fun `isPreviewBuild=false is exposed via uiState from initial state`() {
        val prodVm = AgeVerificationSubmitViewModel(repo, isPreviewBuild = false)
        assertFalse(prodVm.uiState.value.isPreviewBuild)
    }

    @Test
    fun `isPreviewBuild flag survives state transitions (copy preserves it)`() {
        val previewVm = AgeVerificationSubmitViewModel(repo, isPreviewBuild = true)
        previewVm.acknowledgeExplanation()
        previewVm.selectMethod(IdMethod.Passport)
        previewVm.setImage(byteArrayOf(0x01), ContentType.Jpeg)
        // Now at Confirm; flag must still be true so the screen can
        // re-display the warning if the user steps back to PickImage.
        assertTrue(previewVm.uiState.value.isPreviewBuild)
    }

    @Test
    fun `isPreviewBuild flag is still true when stepping back to PickImage from Confirm`() {
        val previewVm = AgeVerificationSubmitViewModel(repo, isPreviewBuild = true)
        previewVm.acknowledgeExplanation()
        previewVm.selectMethod(IdMethod.Passport)
        previewVm.setImage(byteArrayOf(0x01), ContentType.Jpeg)
        previewVm.back() // Confirm → PickImage; warning is rendered here
        assertEquals(AgeVerificationSubmitStep.PickImage, previewVm.uiState.value.step)
        assertTrue(previewVm.uiState.value.isPreviewBuild)
    }

    // ─── Forward transitions ────────────────────────────────────

    @Test
    fun `acknowledgeExplanation moves to PickMethod`() {
        viewModel.acknowledgeExplanation()
        assertEquals(AgeVerificationSubmitStep.PickMethod, viewModel.uiState.value.step)
    }

    @Test
    fun `selectMethod stores choice and moves to PickImage`() {
        viewModel.acknowledgeExplanation()
        viewModel.selectMethod(IdMethod.Passport)
        assertEquals(AgeVerificationSubmitStep.PickImage, viewModel.uiState.value.step)
        assertEquals(IdMethod.Passport, viewModel.uiState.value.selectedMethod)
    }

    @Test
    fun `setImage stores bytes and moves to Confirm`() {
        viewModel.acknowledgeExplanation()
        viewModel.selectMethod(IdMethod.NationalId)
        viewModel.setImage(byteArrayOf(0x01, 0x02), ContentType.Jpeg)
        assertEquals(AgeVerificationSubmitStep.Confirm, viewModel.uiState.value.step)
        assertEquals(
            2,
            viewModel.uiState.value.imageBytes
                ?.size,
        )
        assertEquals(ContentType.Jpeg, viewModel.uiState.value.imageContentType)
    }

    // ─── Back transitions ──────────────────────────────────────

    @Test
    fun `back from Confirm returns to PickImage and keeps image data`() {
        viewModel.acknowledgeExplanation()
        viewModel.selectMethod(IdMethod.Passport)
        viewModel.setImage(byteArrayOf(0x01), ContentType.Jpeg)
        viewModel.back()
        assertEquals(AgeVerificationSubmitStep.PickImage, viewModel.uiState.value.step)
        // Image data is preserved so the user can decide to keep or
        // replace it without re-picking from scratch.
        assertNotNull(viewModel.uiState.value.imageBytes)
    }

    @Test
    fun `back from PickImage returns to PickMethod`() {
        viewModel.acknowledgeExplanation()
        viewModel.selectMethod(IdMethod.Passport)
        viewModel.back()
        assertEquals(AgeVerificationSubmitStep.PickMethod, viewModel.uiState.value.step)
    }

    @Test
    fun `back from PickMethod returns to Explanation`() {
        viewModel.acknowledgeExplanation()
        viewModel.back()
        assertEquals(AgeVerificationSubmitStep.Explanation, viewModel.uiState.value.step)
    }

    @Test
    fun `back from Explanation is a no-op (screen pops navigation instead)`() {
        viewModel.back()
        assertEquals(AgeVerificationSubmitStep.Explanation, viewModel.uiState.value.step)
    }

    @Test
    fun `back from Submitted is a no-op`() {
        // Force Submitted state and verify back() doesn't reset.
        runTest(testDispatcher) {
            primeRepoForSuccess()
            viewModel.acknowledgeExplanation()
            viewModel.selectMethod(IdMethod.Passport)
            viewModel.setImage(byteArrayOf(0x01), ContentType.Jpeg)
            viewModel.submit()
            advanceUntilIdle()
            assertEquals(AgeVerificationSubmitStep.Submitted, viewModel.uiState.value.step)

            viewModel.back()
            assertEquals(AgeVerificationSubmitStep.Submitted, viewModel.uiState.value.step)
        }
    }

    // ─── submit() pre-validation ────────────────────────────────

    @Test
    fun `submit without method sets error_no_method and stays on step`() {
        viewModel.submit()
        assertNotNull(viewModel.uiState.value.error)
        assertFalse(viewModel.uiState.value.isSubmitting)
    }

    @Test
    fun `submit with method but no image sets error_no_image`() {
        viewModel.acknowledgeExplanation()
        viewModel.selectMethod(IdMethod.Passport)
        viewModel.submit()
        assertNotNull(viewModel.uiState.value.error)
        assertFalse(viewModel.uiState.value.isSubmitting)
    }

    // ─── submit() happy path ───────────────────────────────────

    @Test
    fun `submit happy path runs all three calls in order and reaches Submitted`() =
        runTest(testDispatcher) {
            primeRepoForSuccess()
            viewModel.acknowledgeExplanation()
            viewModel.selectMethod(IdMethod.DriversLicense)
            viewModel.setImage(byteArrayOf(0x01, 0x02, 0x03), ContentType.Jpeg)

            viewModel.submit()
            advanceUntilIdle()

            assertEquals(AgeVerificationSubmitStep.Submitted, viewModel.uiState.value.step)
            assertFalse(viewModel.uiState.value.isSubmitting)
            assertEquals(1, repo.requestUploadUrlCalls)
            assertEquals(1, repo.uploadImageCalls)
            assertEquals(1, repo.submitCalls)
            assertEquals(IdMethod.DriversLicense, repo.lastSubmitMethod)
        }

    @Test
    fun `submit failure on requestUploadUrl stays at Confirm with error`() =
        runTest(testDispatcher) {
            repo.uploadUrlResult = Resource.Error("offline")
            viewModel.acknowledgeExplanation()
            viewModel.selectMethod(IdMethod.Passport)
            viewModel.setImage(byteArrayOf(0x01), ContentType.Jpeg)

            viewModel.submit()
            advanceUntilIdle()

            assertEquals(AgeVerificationSubmitStep.Confirm, viewModel.uiState.value.step)
            assertNotNull(viewModel.uiState.value.error)
            assertFalse(viewModel.uiState.value.isSubmitting)
            assertEquals(0, repo.uploadImageCalls)
            assertEquals(0, repo.submitCalls)
        }

    @Test
    fun `submit failure on uploadImage skips submit() and stays at Confirm with error`() =
        runTest(testDispatcher) {
            repo.uploadUrlResult =
                Resource.Success(UploadHandle("https://r2/sig", "age-verification/u1/k.jpg", 300))
            repo.uploadImageResult = Resource.Error("R2 timeout")
            viewModel.acknowledgeExplanation()
            viewModel.selectMethod(IdMethod.Passport)
            viewModel.setImage(byteArrayOf(0x01), ContentType.Jpeg)

            viewModel.submit()
            advanceUntilIdle()

            assertEquals(AgeVerificationSubmitStep.Confirm, viewModel.uiState.value.step)
            assertNotNull(viewModel.uiState.value.error)
            assertFalse(viewModel.uiState.value.isSubmitting)
            // Crucially: submit() must NOT have been called — without
            // bytes in R2, marking the submission pending would surface
            // a broken record to the admin.
            assertEquals(0, repo.submitCalls)
        }

    @Test
    fun `submit failure on submit() stays at Confirm with error`() =
        runTest(testDispatcher) {
            repo.uploadUrlResult =
                Resource.Success(UploadHandle("https://r2/sig", "age-verification/u1/k.jpg", 300))
            repo.uploadImageResult = Resource.Success(Unit)
            repo.submitResult = Resource.Error("server error")
            viewModel.acknowledgeExplanation()
            viewModel.selectMethod(IdMethod.Passport)
            viewModel.setImage(byteArrayOf(0x01), ContentType.Jpeg)

            viewModel.submit()
            advanceUntilIdle()

            assertEquals(AgeVerificationSubmitStep.Confirm, viewModel.uiState.value.step)
            assertNotNull(viewModel.uiState.value.error)
            assertFalse(viewModel.uiState.value.isSubmitting)
        }

    // ─── Resource.Loading contract-violation paths ──────────────
    //
    // `requestUploadUrl`, `uploadImage`, and `submit` are suspend
    // functions returning Resource<T>. By contract they should resolve
    // to Success or Error — never Loading (Loading is a Flow-emission
    // state). But `Resource<T>` is a 3-state sealed class, so a buggy
    // or refactored repo impl could leak Loading. Without defensive
    // handling the user is stranded with `isSubmitting = true` forever
    // and no error to retry on. These tests pin the recovery contract:
    // treat Loading as a generic submit error so the user can retry.

    @Test
    fun `submit Loading from requestUploadUrl recovers as error and stops spinner`() =
        runTest(testDispatcher) {
            repo.uploadUrlResult = Resource.Loading
            viewModel.acknowledgeExplanation()
            viewModel.selectMethod(IdMethod.Passport)
            viewModel.setImage(byteArrayOf(0x01), ContentType.Jpeg)

            viewModel.submit()
            advanceUntilIdle()

            assertEquals(AgeVerificationSubmitStep.Confirm, viewModel.uiState.value.step)
            assertNotNull(viewModel.uiState.value.error)
            assertFalse(viewModel.uiState.value.isSubmitting)
            assertEquals(0, repo.uploadImageCalls)
            assertEquals(0, repo.submitCalls)
        }

    @Test
    fun `submit Loading from uploadImage recovers as error and stops spinner`() =
        runTest(testDispatcher) {
            repo.uploadUrlResult =
                Resource.Success(UploadHandle("https://r2/sig", "age-verification/u1/k.jpg", 300))
            repo.uploadImageResult = Resource.Loading
            viewModel.acknowledgeExplanation()
            viewModel.selectMethod(IdMethod.Passport)
            viewModel.setImage(byteArrayOf(0x01), ContentType.Jpeg)

            viewModel.submit()
            advanceUntilIdle()

            assertEquals(AgeVerificationSubmitStep.Confirm, viewModel.uiState.value.step)
            assertNotNull(viewModel.uiState.value.error)
            assertFalse(viewModel.uiState.value.isSubmitting)
            // Crucially: submit() must NOT have been called — without
            // bytes in R2, marking the submission pending would surface
            // a broken record to the admin (mirrors the Error path).
            assertEquals(0, repo.submitCalls)
        }

    @Test
    fun `submit Loading from submit() recovers as error and stops spinner`() =
        runTest(testDispatcher) {
            repo.uploadUrlResult =
                Resource.Success(UploadHandle("https://r2/sig", "age-verification/u1/k.jpg", 300))
            repo.uploadImageResult = Resource.Success(Unit)
            repo.submitResult = Resource.Loading
            viewModel.acknowledgeExplanation()
            viewModel.selectMethod(IdMethod.Passport)
            viewModel.setImage(byteArrayOf(0x01), ContentType.Jpeg)

            viewModel.submit()
            advanceUntilIdle()

            assertEquals(AgeVerificationSubmitStep.Confirm, viewModel.uiState.value.step)
            assertNotNull(viewModel.uiState.value.error)
            assertFalse(viewModel.uiState.value.isSubmitting)
        }

    @Test
    fun `clearError nulls the error`() =
        runTest(testDispatcher) {
            repo.uploadUrlResult = Resource.Error("offline")
            viewModel.acknowledgeExplanation()
            viewModel.selectMethod(IdMethod.Passport)
            viewModel.setImage(byteArrayOf(0x01), ContentType.Jpeg)
            viewModel.submit()
            advanceUntilIdle()
            assertNotNull(viewModel.uiState.value.error)

            viewModel.clearError()
            assertNull(viewModel.uiState.value.error)
        }

    private fun primeRepoForSuccess() {
        repo.uploadUrlResult =
            Resource.Success(UploadHandle("https://r2/sig", "age-verification/u1/key.jpg", 300))
        repo.uploadImageResult = Resource.Success(Unit)
        repo.submitResult = Resource.Success(Unit)
    }

    /**
     * In-memory fake of [AgeVerificationRepository]. Captures call
     * counts + last arguments; pre-set the `*Result` properties to
     * shape the response for each test.
     */
    private class FakeAgeVerificationRepository : AgeVerificationRepository {
        var uploadUrlResult: Resource<UploadHandle> = Resource.Error("not configured")
        var uploadImageResult: Resource<Unit> = Resource.Error("not configured")
        var submitResult: Resource<Unit> = Resource.Error("not configured")

        var requestUploadUrlCalls = 0
        var uploadImageCalls = 0
        var submitCalls = 0
        var lastSubmitMethod: IdMethod? = null
        var lastSubmitR2Key: String? = null

        override suspend fun requestUploadUrl(contentType: ContentType): Resource<UploadHandle> {
            requestUploadUrlCalls++
            return uploadUrlResult
        }

        override suspend fun uploadImage(
            uploadUrl: String,
            contentType: ContentType,
            bytes: ByteArray,
        ): Resource<Unit> {
            uploadImageCalls++
            return uploadImageResult
        }

        override suspend fun submit(
            idMethod: IdMethod,
            r2Key: String,
        ): Resource<Unit> {
            submitCalls++
            lastSubmitMethod = idMethod
            lastSubmitR2Key = r2Key
            return submitResult
        }
    }
}
