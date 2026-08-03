package com.shyden.shytalk.feature.ageverification

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.semantics.getOrNull
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextEquals
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.text.AnnotatedString
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AgeVerificationRepository
import com.shyden.shytalk.data.repository.AgeVerificationRepository.ContentType
import com.shyden.shytalk.data.repository.AgeVerificationRepository.IdMethod
import com.shyden.shytalk.data.repository.AgeVerificationRepository.UploadHandle
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * Compose UI test for the non-prod simulation warning on
 * [AgeVerificationSubmitScreen]. Verifies the actual rendered behaviour:
 *  - When the VM is constructed with `isPreviewBuild = true`, advancing to
 *    the PickImage step renders the warning banner (testTag is reachable
 *    via `onNodeWithTag` — pins the modifier-chain ordering as well).
 *  - When the VM is constructed with `isPreviewBuild = false`, the warning
 *    banner is absent at every step.
 *  - The warning is NOT shown on the Explanation step or PickMethod step
 *    even in preview builds (pins the step gate).
 *
 * Per the strict TDD rule (`feedback-tdd.md`) and the Compose UI mandate of
 * the global code-reviewer (`~/.claude/agents/code-reviewer.md`): every
 * `testTag` constant must have a matching `onNodeWithTag` use, and the
 * modifier chain must be ordered so semantics merging captures the full
 * visual container. This test file is the contract for both.
 */
@RunWith(AndroidJUnit4::class)
class AgeVerificationSubmitScreenTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    private val fakeRepo =
        object : AgeVerificationRepository {
            override suspend fun requestUploadUrl(contentType: ContentType): Resource<UploadHandle> =
                Resource.Error("not used in this test")

            override suspend fun uploadImage(
                uploadUrl: String,
                contentType: ContentType,
                bytes: ByteArray,
            ): Resource<Unit> = Resource.Error("not used in this test")

            override suspend fun submit(
                idMethod: IdMethod,
                r2Key: String,
            ): Resource<Unit> = Resource.Error("not used in this test")
        }

    // ─── Preview build: warning shown on PickImage ──────────────────

    @Test
    fun warningIsShownOnPickImageStep_whenIsPreviewBuildTrue() {
        val previewVm = AgeVerificationSubmitViewModel(fakeRepo, isPreviewBuild = true)
        composeTestRule.setContent {
            MaterialTheme {
                AgeVerificationSubmitScreen(onClose = {}, viewModel = previewVm)
            }
        }
        // Step 1 -> 2: acknowledge explanation
        composeTestRule.onNodeWithTag(TAG_AGE_VERIF_CONTINUE).performClick()
        // Step 2 -> 3: pick a method (any)
        composeTestRule.onNodeWithTag(TAG_AGE_VERIF_METHOD_PASSPORT).performClick()
        // Step 3 (PickImage) — warning banner must be visible.
        // assertIsDisplayed enforces semantics-merging is correct: if the
        // testTag was placed AFTER padding (the ordering bug), the node
        // would still exist but `assertIsDisplayed` may fail because the
        // tag is attached to the inner padded content, not the visible
        // container. This test pins the modifier-chain ordering.
        composeTestRule
            .onNodeWithTag(TAG_AGE_VERIF_TEST_ENV_WARNING)
            .assertIsDisplayed()
        // Also verify the actual warning copy renders (catches the case
        // where the container is present but `stringResource` failed
        // silently, leaving the banner as a blank box). Use exact-match
        // for both the label and the body so each onNodeWithText resolves
        // to exactly one node — substring matches surface BOTH the label
        // ("Test environment") AND the body (which contains "test
        // environment" inside it), which fails onNodeWithText's
        // single-node contract. Strings come from
        // `composeResources/values/strings.xml`:
        //   age_verif_test_env_label = "Test environment"
        //   age_verif_test_env_warning = "Upload any image — this is a
        //     test environment, real IDs are not required and not
        //     stored long-term."
        composeTestRule
            .onNodeWithText("Test environment")
            .assertIsDisplayed()
        composeTestRule
            .onNodeWithText(
                "Upload any image — this is a test environment, real IDs are not required and not stored long-term.",
            ).assertIsDisplayed()
    }

    // ─── Prod build: warning absent on every step ──────────────────

    @Test
    fun warningIsAbsentOnPickImageStep_whenIsPreviewBuildFalse() {
        val prodVm = AgeVerificationSubmitViewModel(fakeRepo, isPreviewBuild = false)
        composeTestRule.setContent {
            MaterialTheme {
                AgeVerificationSubmitScreen(onClose = {}, viewModel = prodVm)
            }
        }
        composeTestRule.onNodeWithTag(TAG_AGE_VERIF_CONTINUE).performClick()
        composeTestRule.onNodeWithTag(TAG_AGE_VERIF_METHOD_DRIVERS).performClick()
        // Step 3 (PickImage) — warning banner must NOT exist on prod.
        composeTestRule
            .onAllNodesWithTag(TAG_AGE_VERIF_TEST_ENV_WARNING)
            .assertCountEquals(0)
    }

    // ─── Step gate: even on preview, warning hidden until PickImage ──

    @Test
    fun warningIsAbsentOnExplanationStep_evenInPreviewBuild() {
        val previewVm = AgeVerificationSubmitViewModel(fakeRepo, isPreviewBuild = true)
        composeTestRule.setContent {
            MaterialTheme {
                AgeVerificationSubmitScreen(onClose = {}, viewModel = previewVm)
            }
        }
        // Land on Explanation. Do NOT advance. Warning must be hidden —
        // we shouldn't surface "test environment" copy until the user
        // is actually about to upload anything.
        composeTestRule
            .onAllNodesWithTag(TAG_AGE_VERIF_TEST_ENV_WARNING)
            .assertCountEquals(0)
    }

    @Test
    fun warningIsAbsentOnPickMethodStep_evenInPreviewBuild() {
        val previewVm = AgeVerificationSubmitViewModel(fakeRepo, isPreviewBuild = true)
        composeTestRule.setContent {
            MaterialTheme {
                AgeVerificationSubmitScreen(onClose = {}, viewModel = previewVm)
            }
        }
        // Advance to PickMethod (one step before PickImage). Warning
        // is still gated.
        composeTestRule.onNodeWithTag(TAG_AGE_VERIF_CONTINUE).performClick()
        composeTestRule
            .onAllNodesWithTag(TAG_AGE_VERIF_TEST_ENV_WARNING)
            .assertCountEquals(0)
    }

    // ─── Round-trip: warning re-renders when user steps back to PickImage ──

    @Test
    fun warningReappears_whenUserStepsBackFromConfirmToPickImage() {
        val previewVm = AgeVerificationSubmitViewModel(fakeRepo, isPreviewBuild = true)
        composeTestRule.setContent {
            MaterialTheme {
                AgeVerificationSubmitScreen(onClose = {}, viewModel = previewVm)
            }
        }
        // Advance: Explanation -> PickMethod -> PickImage
        composeTestRule.onNodeWithTag(TAG_AGE_VERIF_CONTINUE).performClick()
        composeTestRule.onNodeWithTag(TAG_AGE_VERIF_METHOD_NATIONAL).performClick()
        // Confirm warning is visible at PickImage
        composeTestRule
            .onNodeWithTag(TAG_AGE_VERIF_TEST_ENV_WARNING)
            .assertIsDisplayed()
        // Drive the VM forward to Confirm by simulating image attached
        previewVm.setImage(byteArrayOf(0x01), ContentType.Jpeg)
        composeTestRule.waitForIdle()
        // Warning must NOT show on Confirm step
        composeTestRule
            .onAllNodesWithTag(TAG_AGE_VERIF_TEST_ENV_WARNING)
            .assertCountEquals(0)
        // Step back to PickImage via VM back()
        previewVm.back()
        composeTestRule.waitForIdle()
        // Warning is back
        composeTestRule
            .onNodeWithTag(TAG_AGE_VERIF_TEST_ENV_WARNING)
            .assertIsDisplayed()
    }

    // ─── Rendered CONTENT of the method buttons (SHY-0271) ─────────────

    /** Set by [showPickMethodStep] so a test can drive the flow past PickImage. */
    private lateinit var pickMethodVm: AgeVerificationSubmitViewModel

    /** Advances to the PickMethod step, where the three ID buttons live. */
    private fun showPickMethodStep() {
        pickMethodVm = AgeVerificationSubmitViewModel(fakeRepo, isPreviewBuild = true)
        composeTestRule.setContent {
            MaterialTheme {
                AgeVerificationSubmitScreen(onClose = {}, viewModel = pickMethodVm)
            }
        }
        composeTestRule.onNodeWithTag(TAG_AGE_VERIF_CONTINUE).performClick()
    }

    @Test
    fun methodButtonsRenderTheirLabels_notJustTheirTags() {
        // The operator read `Driver\'s license` — backslash and all — off this
        // screen, and it had shipped. Every test above CLICKS these buttons by
        // tag and none reads them, so a corrupt label passed the whole suite.
        //
        // `\'` is ANDROID XML escaping; Compose Multiplatform's
        // `composeResources` does not unescape it, so it reaches the screen
        // verbatim. Asserting the tag proves a button exists; only asserting
        // the TEXT proves it says the right thing.
        showPickMethodStep()
        mapOf(
            TAG_AGE_VERIF_METHOD_PASSPORT to "Passport",
            TAG_AGE_VERIF_METHOD_DRIVERS to "Driver's license",
            TAG_AGE_VERIF_METHOD_NATIONAL to "National ID card",
        ).forEach { (tag, label) ->
            // Compose merges a clickable's descendants, so the Button's node
            // carries its child Text — the same node the click tests use.
            composeTestRule.onNodeWithTag(tag).assertTextEquals(label)
        }
    }

    /**
     * Every user-readable string currently composed, from all three semantics
     * properties a user can perceive.
     *
     * `ContentDescription` matters as much as `Text` here: the back control at
     * `AgeVerificationSubmitScreen` carries its label only as a description, so
     * a sweep over `Text` alone would let a corrupt string reach every TalkBack
     * user unchallenged. `EditableText` is what a field's own contents live in.
     */
    private fun visibleStrings(): List<String> =
        listOf(
            SemanticsProperties.Text,
            SemanticsProperties.EditableText,
            SemanticsProperties.ContentDescription,
        ).flatMap { key ->
            composeTestRule
                .onAllNodes(SemanticsMatcher.keyIsDefined(key), useUnmergedTree = true)
                .fetchSemanticsNodes()
                .flatMap { node ->
                    when (val v = node.config.getOrNull(key)) {
                        is AnnotatedString -> listOf(v.text)
                        is List<*> -> v.map { it.toString() }
                        null -> emptyList()
                        else -> listOf(v.toString())
                    }
                }
        }

    @Test
    fun noRenderedTextOnAnyStepCarriesAnEscapeSequence() {
        // The general form of the same defect. Walks EVERY step of the flow —
        // an earlier version only rendered PickMethod and so covered about a
        // third of the screen's copy while being named after the whole of it.
        showPickMethodStep()
        val offenders = mutableListOf<String>()
        offenders += visibleStrings().filter(::carriesEscape)

        composeTestRule.onNodeWithTag(TAG_AGE_VERIF_METHOD_PASSPORT).performClick()
        composeTestRule.waitForIdle()
        offenders += visibleStrings().filter(::carriesEscape) // PickImage

        pickMethodVm.setImage(byteArrayOf(0x01), ContentType.Jpeg)
        composeTestRule.waitForIdle()
        offenders += visibleStrings().filter(::carriesEscape) // Confirm

        pickMethodVm.back()
        composeTestRule.waitForIdle()
        offenders += visibleStrings().filter(::carriesEscape)

        assertEquals(emptyList<String>(), offenders.distinct().sorted())
    }

    @Test
    fun theSweepCoversMoreThanASingleStep() {
        // Guards the walk itself. If a future edit collapses the test back to
        // one step, the copy it stops covering would vanish silently — the
        // sweep would still pass, on less. Pins that the flow actually moves.
        showPickMethodStep()
        val atPickMethod = visibleStrings()
        composeTestRule.onNodeWithTag(TAG_AGE_VERIF_METHOD_PASSPORT).performClick()
        composeTestRule.waitForIdle()
        val atPickImage = visibleStrings()
        assertTrue("the flow did not advance — the sweep would cover one step", atPickImage != atPickMethod)
        assertTrue("no strings were read at all", atPickMethod.isNotEmpty() && atPickImage.isNotEmpty())
    }

    @Test
    fun theEscapeSweepCanActuallyFail() {
        // Mutation guard on the SHARED predicate used by the sweep above — not
        // an inline copy of it. A guard with its own private copy stays green
        // while the real rule is weakened, which proves only that Kotlin's
        // `String.contains` works.
        assertTrue(carriesEscape("Driver\\'s license"))
        assertTrue(carriesEscape("an escaped \\\" quote"))
        assertEquals(false, carriesEscape("Driver's license"))
    }
}

/** No user-facing copy in this app legitimately contains a backslash. */
internal fun carriesEscape(s: String): Boolean = s.contains('\\')
