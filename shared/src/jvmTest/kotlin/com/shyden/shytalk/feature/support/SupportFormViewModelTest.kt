package com.shyden.shytalk.feature.support

import com.shyden.shytalk.data.repository.AttachmentType
import com.shyden.shytalk.data.repository.RaiseTicketOutcome
import com.shyden.shytalk.data.repository.SupportCategory
import com.shyden.shytalk.data.repository.SupportRepository
import com.shyden.shytalk.data.repository.UploadHandle
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
 * SHY-0385 — the in-app support form.
 *
 * The behaviour worth pinning is not the happy path. It is that a failed send
 * KEEPS what the person typed, that a blank message never reaches the server,
 * and that an existing open ticket is explained rather than silently duplicated.
 *
 * A person raising a support ticket is, by definition, already having a bad
 * time. Losing their message to a dropped connection is the worst thing this
 * screen can do.
 */
@OptIn(ExperimentalCoroutinesApi::class)
class SupportFormViewModelTest {
    private val testDispatcher = StandardTestDispatcher()
    private lateinit var repo: FakeSupportRepository
    private lateinit var viewModel: SupportFormViewModel

    @BeforeTest
    fun setup() {
        Dispatchers.setMain(testDispatcher)
        repo = FakeSupportRepository()
        viewModel = SupportFormViewModel(repo, SupportCategory.Other, emptyMap())
    }

    @AfterTest
    fun tearDown() {
        Dispatchers.resetMain()
    }

    // ─── Sending ────────────────────────────────────────────────

    @Test
    fun `a message is sent and the person is told it arrived`() =
        runTest {
            viewModel.updateMessage("My date of birth is wrong.")
            viewModel.submit()
            advanceUntilIdle()

            assertEquals(1, repo.raiseCalls.size)
            assertEquals("My date of birth is wrong.", repo.raiseCalls[0].message)
            assertTrue(viewModel.uiState.value.submitted)
            assertNull(viewModel.uiState.value.error)
        }

    @Test
    fun `the entry point's category is sent`() =
        runTest {
            viewModel = SupportFormViewModel(repo, SupportCategory.Age, emptyMap())
            viewModel.updateMessage("Help")
            viewModel.submit()
            advanceUntilIdle()

            assertEquals(SupportCategory.Age, repo.raiseCalls[0].category)
        }

    @Test
    fun `originating context is passed through`() =
        runTest {
            viewModel =
                SupportFormViewModel(
                    repo,
                    SupportCategory.Age,
                    mapOf("feature" to "lucky_spin", "reason" to "age_restriction"),
                )
            viewModel.updateMessage("Help")
            viewModel.submit()
            advanceUntilIdle()

            assertEquals(
                mapOf("feature" to "lucky_spin", "reason" to "age_restriction"),
                repo.raiseCalls[0].context,
            )
        }

    /**
     * The category and context only matter if PRODUCTION supplies them. It did
     * not: Koin bound `SupportFormViewModel(get())` and every screen resolved it
     * with a bare `koinViewModel()`, so these two tests passed while every real
     * ticket carried `null` and `{}`. `SupportFormWiringPinTest` is what stops
     * that returning; this comment is here so the next person reading these two
     * green tests knows they are only half the proof.
     */
    @Test
    fun `a message that is only too long before trimming is still sent`() =
        runTest {
            val atTheLimit = "x".repeat(SUPPORT_MESSAGE_MAX_LENGTH)
            viewModel.updateMessage("  $atTheLimit  ")
            viewModel.submit()
            advanceUntilIdle()

            assertEquals(1, repo.raiseCalls.size, "trailing whitespace must not cost a refusal")
            assertEquals(atTheLimit, repo.raiseCalls[0].message)
            assertNull(viewModel.uiState.value.error)
        }

    // ─── Coming back a second time ──────────────────────────────

    /**
     * The ViewModel is scoped to the SCREEN. Closing the dialog does not destroy
     * it, so without a reset the second visit re-attached an instance still
     * holding `submitted = true` and showed the confirmation instead of a form.
     */
    @Test
    fun `re-opening after a successful send offers a fresh form`() =
        runTest {
            viewModel = SupportFormViewModel(repo, SupportCategory.Age, mapOf("screen" to "room"))
            viewModel.updateMessage("The wheel will not let me spin.")
            viewModel.submit()
            advanceUntilIdle()
            assertTrue(viewModel.uiState.value.submitted)

            viewModel.reset()

            val state = viewModel.uiState.value
            assertFalse(state.submitted, "a second visit must start at a form, not a confirmation")
            assertEquals("", state.message)
            assertNull(state.error)
            assertFalse(state.alreadyHasOpenTicket)
            assertEquals(SupportCategory.Age, state.category, "the entry point still knows why they are here")
        }

    @Test
    fun `reset leaves a send that is still in flight alone`() =
        runTest {
            viewModel.updateMessage("Help")
            // `submit` marks the send in flight synchronously and the launched
            // coroutine only runs on advance, so this is the in-flight moment.
            viewModel.submit()
            assertTrue(viewModel.uiState.value.isSubmitting)

            viewModel.reset()

            assertTrue(viewModel.uiState.value.isSubmitting, "a reset must not orphan a request already sent")
            assertEquals("Help", viewModel.uiState.value.message)
            advanceUntilIdle()
        }

    // ─── SHY-0387: choosing a category, showing the problem ─────

    /**
     * `selectCategory` was removed in SHY-0385 because nothing called it — the
     * dialog had no picker. The page has one, so it is back, and this test is
     * paired with the wiring pin that proves the picker actually calls it.
     */
    @Test
    fun `choosing a category overrides the entry point's default`() =
        runTest {
            viewModel = SupportFormViewModel(repo, SupportCategory.Other, emptyMap())
            viewModel.updateMessage("Charged twice")
            viewModel.selectCategory(SupportCategory.Payment)
            viewModel.submit()
            advanceUntilIdle()

            assertEquals(SupportCategory.Payment, repo.raiseCalls[0].category)
        }

    @Test
    fun `an attached file is uploaded and its key travels with the ticket`() =
        runTest {
            viewModel.attach("shot.png", AttachmentType.Png, ByteArray(64))
            advanceUntilIdle()
            viewModel.updateMessage("Here is what I see.")
            viewModel.submit()
            advanceUntilIdle()

            assertEquals(listOf(64), repo.uploadedBytes)
            assertEquals(listOf("support-tickets/1/a.png"), repo.raiseCalls[0].attachments)
        }

    @Test
    fun `the person can see what they attached`() =
        runTest {
            viewModel.attach("shot.png", AttachmentType.Png, ByteArray(8))
            advanceUntilIdle()

            val shown = viewModel.uiState.value.attachments
            assertEquals(1, shown.size)
            assertEquals("shot.png", shown[0].displayName)
        }

    /**
     * The story is explicit: an attachment that fails must be reported AND the
     * rest of the ticket must still be sendable without it. A failed upload that
     * silently drops the file is the worse half of that.
     */
    @Test
    fun `a failed upload is reported and does not block the ticket`() =
        runTest {
            repo.uploadSucceeds = false
            viewModel.attach("shot.png", AttachmentType.Png, ByteArray(8))
            advanceUntilIdle()

            assertNotNull(viewModel.uiState.value.error)
            assertTrue(
                viewModel.uiState.value.attachments
                    .isEmpty(),
                "a file that did not upload is not attached",
            )

            viewModel.updateMessage("Sending anyway.")
            viewModel.submit()
            advanceUntilIdle()

            assertEquals(1, repo.raiseCalls.size)
            assertTrue(repo.raiseCalls[0].attachments.isEmpty())
        }

    @Test
    fun `an upload the server refuses to authorise is reported, not silently dropped`() =
        runTest {
            repo.handleOrNull = { null }
            viewModel.attach("shot.png", AttachmentType.Png, ByteArray(8))
            advanceUntilIdle()

            assertNotNull(viewModel.uiState.value.error)
            assertTrue(
                viewModel.uiState.value.attachments
                    .isEmpty(),
            )
        }

    @Test
    fun `attaching, removing and re-attaching leaves the right set`() =
        runTest {
            viewModel.attach("one.png", AttachmentType.Png, ByteArray(8))
            advanceUntilIdle()
            viewModel.attach("two.png", AttachmentType.Png, ByteArray(8))
            advanceUntilIdle()
            viewModel.removeAttachment("support-tickets/1/a.png")
            viewModel.updateMessage("Just the second one.")
            viewModel.submit()
            advanceUntilIdle()

            assertEquals(listOf("support-tickets/1/b.png"), repo.raiseCalls[0].attachments)
        }

    @Test
    fun `a file too large to send is refused before any upload starts`() =
        runTest {
            viewModel.attach("huge.mp4", AttachmentType.Mp4, ByteArray(MAX_ATTACHMENT_BYTES + 1))
            advanceUntilIdle()

            assertTrue(repo.uploadedBytes.isEmpty(), "the bytes must never leave the device")
            assertNotNull(viewModel.uiState.value.error)
            assertTrue(
                viewModel.uiState.value.attachments
                    .isEmpty(),
            )
        }

    @Test
    fun `a sent ticket's attachments do not follow them back`() =
        runTest {
            viewModel.attach("one.png", AttachmentType.Png, ByteArray(8))
            advanceUntilIdle()
            viewModel.updateMessage("Sending this")
            viewModel.submit()
            advanceUntilIdle()

            viewModel.reset()

            assertTrue(
                viewModel.uiState.value.attachments
                    .isEmpty(),
            )
        }

    /**
     * A back-press is easy to hit by accident, and this page is reached by people
     * already having a bad time. SHY-0385's rule -- never lose what somebody
     * typed -- applies to LEAVING the page, not only to a failed send.
     */
    @Test
    fun `leaving without sending keeps what was typed`() =
        runTest {
            viewModel.updateMessage("Half a sentence I have not finished")

            viewModel.reset()

            assertEquals("Half a sentence I have not finished", viewModel.uiState.value.message)
        }

    @Test
    fun `leaving without sending keeps the attachments too`() =
        runTest {
            viewModel.attach("one.png", AttachmentType.Png, ByteArray(8))
            advanceUntilIdle()

            viewModel.reset()

            assertEquals(1, viewModel.uiState.value.attachments.size)
        }

    @Test
    fun `leaving without sending clears a stale complaint`() =
        runTest {
            viewModel.submit()
            advanceUntilIdle()
            assertNotNull(viewModel.uiState.value.error)

            viewModel.reset()

            assertNull(viewModel.uiState.value.error, "an old complaint must not greet them on the way back")
        }

    // ─── Refusing before it reaches the server ──────────────────

    @Test
    fun `an empty message never reaches the server`() =
        runTest {
            viewModel.submit()
            advanceUntilIdle()

            assertTrue(repo.raiseCalls.isEmpty())
            assertNotNull(viewModel.uiState.value.error)
            assertFalse(viewModel.uiState.value.submitted)
        }

    @Test
    fun `a whitespace-only message never reaches the server`() =
        runTest {
            viewModel.updateMessage("   \n\t  ")
            viewModel.submit()
            advanceUntilIdle()

            assertTrue(repo.raiseCalls.isEmpty())
            assertNotNull(viewModel.uiState.value.error)
        }

    @Test
    fun `the message is bounded rather than silently truncated on send`() =
        runTest {
            viewModel.updateMessage("x".repeat(2001))
            viewModel.submit()
            advanceUntilIdle()

            assertTrue(repo.raiseCalls.isEmpty())
            assertNotNull(viewModel.uiState.value.error)
        }

    // ─── Failure keeps what was typed ───────────────────────────

    @Test
    fun `a failed send keeps the message`() =
        runTest {
            repo.result = RaiseTicketOutcome.Failed("Network unreachable")
            viewModel.updateMessage("Something important I typed")
            viewModel.submit()
            advanceUntilIdle()

            // THE test for this screen. Somebody asking for help must not lose
            // what they wrote because the connection dropped.
            assertEquals("Something important I typed", viewModel.uiState.value.message)
            assertNotNull(viewModel.uiState.value.error)
            assertFalse(viewModel.uiState.value.submitted)
        }

    @Test
    fun `a failed send can be retried without retyping`() =
        runTest {
            repo.result = RaiseTicketOutcome.Failed("Network unreachable")
            viewModel.updateMessage("Retry me")
            viewModel.submit()
            advanceUntilIdle()

            repo.result = RaiseTicketOutcome.Raised("ticket-2")
            viewModel.submit()
            advanceUntilIdle()

            assertEquals(2, repo.raiseCalls.size)
            assertEquals("Retry me", repo.raiseCalls[1].message)
            assertTrue(viewModel.uiState.value.submitted)
        }

    @Test
    fun `an existing open ticket is explained, not silently duplicated`() =
        runTest {
            // Typed, not string-matched. Resource.Error carries only a message,
            // so recognising a duplicate by its English text would break the
            // moment the server reworded it -- or for anyone not reading English.
            repo.result = RaiseTicketOutcome.AlreadyOpen
            viewModel.updateMessage("Another one")
            viewModel.submit()
            advanceUntilIdle()

            assertNotNull(viewModel.uiState.value.error)
            assertTrue(viewModel.uiState.value.alreadyHasOpenTicket)
            assertFalse(viewModel.uiState.value.submitted)
            assertEquals("Another one", viewModel.uiState.value.message)
        }

    // ─── Double-submit ──────────────────────────────────────────

    @Test
    fun `submitting twice quickly sends once`() =
        runTest {
            viewModel.updateMessage("Only once please")
            viewModel.submit()
            viewModel.submit()
            advanceUntilIdle()

            assertEquals(1, repo.raiseCalls.size)
        }

    @Test
    fun `the send is marked in flight while it runs`() =
        runTest {
            viewModel.updateMessage("Help")
            viewModel.submit()
            assertTrue(viewModel.uiState.value.isSubmitting)
            advanceUntilIdle()
            assertFalse(viewModel.uiState.value.isSubmitting)
        }

    @Test
    fun `editing the message clears a previous error`() =
        runTest {
            viewModel.submit()
            advanceUntilIdle()
            assertNotNull(viewModel.uiState.value.error)

            viewModel.updateMessage("Now I have typed something")
            assertNull(viewModel.uiState.value.error)
        }
}

/**
 * Hand-written fake. `jvmTest` is a unit-test source set, which the no-stubs
 * ratchet exempts by policy — doubles are allowed here and nowhere else.
 */
private class FakeSupportRepository : SupportRepository {
    data class Call(
        val message: String,
        val category: SupportCategory?,
        val context: Map<String, String>,
        val attachments: List<String>,
    )

    val raiseCalls = mutableListOf<Call>()
    var result: RaiseTicketOutcome = RaiseTicketOutcome.Raised("ticket-1")

    /** Keys handed out in order, so a test can name the one it expects. */
    var nextKeys = ArrayDeque(listOf("support-tickets/1/a.png", "support-tickets/1/b.png"))
    var handleOrNull: (() -> UploadHandle?)? = null
    var uploadSucceeds = true
    val uploadedBytes = mutableListOf<Int>()

    override suspend fun raiseTicket(
        message: String,
        category: SupportCategory?,
        context: Map<String, String>,
        attachments: List<String>,
    ): RaiseTicketOutcome {
        raiseCalls.add(Call(message, category, context, attachments))
        return result
    }

    override suspend fun requestAttachmentUpload(contentType: AttachmentType): UploadHandle? {
        handleOrNull?.let { return it() }
        return UploadHandle("https://r2.example/put", nextKeys.removeFirst(), 300)
    }

    override suspend fun uploadAttachment(
        uploadUrl: String,
        contentType: AttachmentType,
        bytes: ByteArray,
    ): Boolean {
        uploadedBytes.add(bytes.size)
        return uploadSucceeds
    }
}
