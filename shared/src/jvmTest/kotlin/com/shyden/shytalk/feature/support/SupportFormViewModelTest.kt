package com.shyden.shytalk.feature.support

import com.shyden.shytalk.data.repository.AttachmentType
import com.shyden.shytalk.data.repository.OpenTicketSummary
import com.shyden.shytalk.data.repository.OpenTicketsView
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

    /** A form belonging to somebody who already has these requests open. */
    private fun formWith(vararg tickets: OpenTicketSummary): SupportFormViewModel {
        repo.open = tickets.toList()
        return SupportFormViewModel(repo, SupportCategory.Other, emptyMap())
    }

    private companion object {
        val BILLING =
            OpenTicketSummary("ticket-77", SupportCategory.Payment, "I was charged twice for coins")
        val ACCOUNT =
            OpenTicketSummary("ticket-88", SupportCategory.Account, "I cannot change my name")
        val SAFETY =
            OpenTicketSummary("ticket-99", SupportCategory.Safety, "Somebody is harassing me")
        val BUG =
            OpenTicketSummary("ticket-11", SupportCategory.Bug, "The wheel will not spin")
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
            assertFalse(state.awaitingDuplicateChoice)
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

    /**
     * Removing has to change the COUNT, not just the picture.
     *
     * The existing test proved the surviving SET was right, which is a
     * different claim: a form that showed two rows while still counting three
     * would satisfy it. What somebody actually relies on is the number — "3 of
     * 10 used" has to become 2, or the tenth slot is silently gone.
     */
    @Test
    fun `removing an attachment decreases how many are attached`() =
        runTest {
            repeat(3) { i ->
                viewModel.attach("file$i.png", AttachmentType.Png, ByteArray(8))
                advanceUntilIdle()
            }
            assertEquals(3, viewModel.uiState.value.attachments.size)

            val removed =
                viewModel.uiState.value.attachments[1]
                    .r2Key
            viewModel.removeAttachment(removed)

            val left = viewModel.uiState.value.attachments
            assertEquals(2, left.size, "removing one of three must leave two")
            assertFalse(left.any { it.r2Key == removed }, "the removed file is still attached")
        }

    /**
     * And the freed slot must be usable again.
     *
     * `attach` refuses at `size >= MAX_ATTACHMENTS`. If removal had been
     * written against a counter that only ever went up — an easy thing to do —
     * the count would look right on screen and the eleventh slot would stay
     * shut for ever. That is the functional half of "3 of 10 becomes 2 of 10".
     */
    @Test
    fun `removing an attachment frees the slot it was using`() =
        runTest {
            repeat(MAX_ATTACHMENTS) { i ->
                viewModel.attach("file$i.png", AttachmentType.Png, ByteArray(8))
                advanceUntilIdle()
            }
            assertEquals(MAX_ATTACHMENTS, viewModel.uiState.value.attachments.size)

            // Full: the next one is refused.
            viewModel.attach("overflow.png", AttachmentType.Png, ByteArray(8))
            advanceUntilIdle()
            assertEquals(MAX_ATTACHMENTS, viewModel.uiState.value.attachments.size)
            assertNotNull(viewModel.uiState.value.error, "a full form must say why")

            viewModel.removeAttachment(
                viewModel.uiState.value.attachments
                    .first()
                    .r2Key,
            )
            assertEquals(MAX_ATTACHMENTS - 1, viewModel.uiState.value.attachments.size)

            // The freed slot is genuinely usable.
            viewModel.attach("replacement.png", AttachmentType.Png, ByteArray(8))
            advanceUntilIdle()
            assertEquals(
                MAX_ATTACHMENTS,
                viewModel.uiState.value.attachments.size,
                "the slot freed by removing a file was never reusable",
            )
            assertTrue(
                viewModel.uiState.value.attachments
                    .any { it.displayName == "replacement.png" },
                "the replacement did not attach",
            )
        }

    /**
     * Removing must delete the file from the server, not just from this screen.
     *
     * The bytes are uploaded the MOMENT a file is picked, before anybody
     * presses Send. So a file removed from the form is already sitting in
     * object storage, and nothing references it: no ticket carries the key, so
     * no retention rule and no erasure request will ever find it.
     *
     * For this screen that is not housekeeping. People attach screenshots of
     * private conversations and video of other people to safety reports. An
     * orphaned copy of that, kept for ever with no purpose, is exactly what
     * data-minimisation forbids — and "I removed it before sending" is the
     * moment somebody most reasonably believes it is gone.
     */
    @Test
    fun `removing an attachment deletes the uploaded file`() =
        runTest {
            viewModel.attach("private.png", AttachmentType.Png, ByteArray(8))
            advanceUntilIdle()
            val key =
                viewModel.uiState.value.attachments
                    .single()
                    .r2Key

            viewModel.removeAttachment(key)
            advanceUntilIdle()

            assertEquals(
                listOf(key),
                repo.deleteCalls,
                "removing an attachment left the uploaded file on the server",
            )
        }

    /**
     * Deleting is best-effort as far as the PERSON is concerned. A server that
     * refuses must not strand a file on their form that they have decided to
     * remove — they would be unable to send at all.
     */
    @Test
    fun `a file is removed from the form even if the server refuses to delete it`() =
        runTest {
            repo.deleteSucceeds = false
            viewModel.attach("stuck.png", AttachmentType.Png, ByteArray(8))
            advanceUntilIdle()
            val key =
                viewModel.uiState.value.attachments
                    .single()
                    .r2Key

            viewModel.removeAttachment(key)
            advanceUntilIdle()

            assertTrue(
                viewModel.uiState.value.attachments
                    .isEmpty(),
                "a failed server delete must not keep the file on the form",
            )
        }

    /**
     * Superseded 2026-08-22. This asserted one flat 25 MB cap over a VIDEO,
     * which is the shape the operator corrected: video is bounded by DURATION
     * now, and 25 MB was never a limit anybody chose. The behaviour it was
     * really protecting — nothing leaves the device before a refusal — is
     * asserted per-kind in the limit tests above.
     */

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

    // ─── The message itself: bounded, counted live, never blank ───

    /**
     * 1,000 characters, operator 2026-08-22 (was 2,000).
     *
     * The count has to be live, because a bound somebody only discovers when
     * they press Send is a bound that costs them the message they just wrote.
     */
    @Test
    fun `a message at the limit is accepted`() =
        runTest {
            viewModel = formWith()
            advanceUntilIdle()
            viewModel.updateMessage("x".repeat(SUPPORT_MESSAGE_MAX_LENGTH))
            viewModel.submit()
            advanceUntilIdle()

            assertEquals(1, repo.raiseCalls.size)
            assertNull(viewModel.uiState.value.error)
        }

    @Test
    fun `a message one character over the limit is refused`() =
        runTest {
            viewModel = formWith()
            advanceUntilIdle()
            viewModel.updateMessage("x".repeat(SUPPORT_MESSAGE_MAX_LENGTH + 1))
            viewModel.submit()
            advanceUntilIdle()

            assertTrue(repo.raiseCalls.isEmpty())
            assertNotNull(viewModel.uiState.value.error)
        }

    @Test
    fun `the limit is one thousand characters`() {
        // Pinned as a NUMBER, not just as a symbol: the operator named it, and
        // the copy on screen and the server's own bound both have to match it.
        assertEquals(1000, SUPPORT_MESSAGE_MAX_LENGTH)
    }

    /** Live, so somebody sees the room they have left as they use it. */
    @Test
    fun `the character count follows what has been typed`() =
        runTest {
            viewModel = formWith()
            advanceUntilIdle()
            assertEquals(0, viewModel.uiState.value.characterCount)

            viewModel.updateMessage("hello")
            assertEquals(5, viewModel.uiState.value.characterCount)

            viewModel.updateMessage("hello there")
            assertEquals(11, viewModel.uiState.value.characterCount)

            viewModel.updateMessage("")
            assertEquals(0, viewModel.uiState.value.characterCount)
        }

    /**
     * Counted on the RAW field, not the trimmed message. Somebody typing spaces
     * has used those characters and the field is holding them; showing a count
     * that disagrees with what is on screen is worse than no count.
     */
    @Test
    fun `the count reflects the field, including spaces`() =
        runTest {
            viewModel = formWith()
            advanceUntilIdle()
            viewModel.updateMessage("  hi  ")
            assertEquals(6, viewModel.uiState.value.characterCount)
        }

    @Test
    fun `the count knows when the limit is passed`() =
        runTest {
            viewModel = formWith()
            advanceUntilIdle()
            viewModel.updateMessage("x".repeat(SUPPORT_MESSAGE_MAX_LENGTH))
            assertFalse(viewModel.uiState.value.isOverCharacterLimit)

            viewModel.updateMessage("x".repeat(SUPPORT_MESSAGE_MAX_LENGTH + 1))
            assertTrue(viewModel.uiState.value.isOverCharacterLimit)
        }

    // ─── Nothing blank ever reaches the queue ───

    @Test
    fun `an empty message is refused`() =
        runTest {
            viewModel = formWith()
            advanceUntilIdle()
            viewModel.submit()
            advanceUntilIdle()

            assertTrue(repo.raiseCalls.isEmpty())
            assertNotNull(viewModel.uiState.value.error)
        }

    /**
     * Whitespace is not a message. A ticket that says nothing costs an admin the
     * same triage as a real one and tells them nothing.
     */
    @Test
    fun `a message of only spaces, tabs and newlines is refused`() =
        runTest {
            for (blank in listOf(" ", "   ", "\t", "\n", " \t\n  ")) {
                viewModel = formWith()
                advanceUntilIdle()
                viewModel.updateMessage(blank)
                viewModel.submit()
                advanceUntilIdle()

                assertTrue(repo.raiseCalls.isEmpty(), "\"$blank\" reached the server")
                assertNotNull(viewModel.uiState.value.error, "\"$blank\" was accepted silently")
            }
        }

    @Test
    fun `a blank message is refused on the add-to-existing path too`() =
        runTest {
            viewModel = formWith(BILLING)
            advanceUntilIdle()
            viewModel.updateMessage("something")
            viewModel.submit()
            advanceUntilIdle()

            viewModel.updateMessage("  \n ")
            viewModel.addToOpenTicket(BILLING.ticketId)
            advanceUntilIdle()

            assertTrue(repo.addCalls.isEmpty())
            assertNotNull(viewModel.uiState.value.error)
        }

    // ─── SHY-0387 attachment limits, corrected by the operator 2026-08-22 ───

    /**
     * The limits this page shipped with were wrong, and one did not exist:
     * a single flat 25 MB byte cap covered images AND video, and nothing
     * checked how LONG a video was.
     *
     * The operator's numbers: 10 files, images to 5 MB, video to 30 SECONDS.
     * Duration, not bytes, because a 30-second clip from a good camera can be
     * 100 MB while a three-minute screen recording can be 4 MB — bounding video
     * by size refuses exactly the wrong files. The limit is a statement about
     * the ADMIN's time, not about storage.
     */
    @Test
    fun `an image at the size limit is accepted`() =
        runTest {
            viewModel.attach("shot.png", AttachmentType.Png, ByteArray(MAX_IMAGE_BYTES))
            advanceUntilIdle()

            assertEquals(1, viewModel.uiState.value.attachments.size)
            assertNull(viewModel.uiState.value.error)
        }

    @Test
    fun `an image over the size limit is refused before any bytes leave the device`() =
        runTest {
            viewModel.attach("huge.png", AttachmentType.Png, ByteArray(MAX_IMAGE_BYTES + 1))
            advanceUntilIdle()

            assertNotNull(viewModel.uiState.value.error)
            assertTrue(
                viewModel.uiState.value.attachments
                    .isEmpty(),
            )
            assertEquals(0, repo.urlRequests, "a refused file must not even ask for an upload slot")
            assertTrue(repo.uploadedBytes.isEmpty())
        }

    @Test
    fun `a video at the length limit is accepted`() =
        runTest {
            viewModel.attach("clip.mp4", AttachmentType.Mp4, ByteArray(64), MAX_VIDEO_DURATION_MS)
            advanceUntilIdle()

            assertEquals(1, viewModel.uiState.value.attachments.size)
            assertNull(viewModel.uiState.value.error)
        }

    @Test
    fun `a video over the length limit is refused before any bytes leave the device`() =
        runTest {
            viewModel.attach("long.mp4", AttachmentType.Mp4, ByteArray(64), MAX_VIDEO_DURATION_MS + 1)
            advanceUntilIdle()

            assertNotNull(viewModel.uiState.value.error)
            assertTrue(
                viewModel.uiState.value.attachments
                    .isEmpty(),
            )
            assertEquals(0, repo.urlRequests)
        }

    /**
     * The whole reason the video limit is a DURATION. A short clip from a good
     * camera is large; refusing it for its size would turn away exactly the
     * evidence an admin most wants.
     */
    @Test
    fun `a big but short video is accepted, because video is bounded by length`() =
        runTest {
            val hefty = ByteArray(MAX_IMAGE_BYTES * 4)
            viewModel.attach("4k.mov", AttachmentType.QuickTime, hefty, 5_000)
            advanceUntilIdle()

            assertEquals(1, viewModel.uiState.value.attachments.size, "size must not refuse a short video")
            assertNull(viewModel.uiState.value.error)
        }

    /**
     * Unknown duration means the rule CANNOT be honoured. Refused honestly with
     * its own sentence rather than borrowed wording: telling somebody a video is
     * too long when we never measured it is a lie they cannot act on.
     */
    @Test
    fun `a video whose length cannot be read is refused honestly`() =
        runTest {
            viewModel.attach("broken.mp4", AttachmentType.Mp4, ByteArray(64), null)
            advanceUntilIdle()

            assertNotNull(viewModel.uiState.value.error)
            assertTrue(
                viewModel.uiState.value.attachments
                    .isEmpty(),
            )
            assertEquals(0, repo.urlRequests)
        }

    /** An image needs no duration, and must not be refused for lacking one. */
    @Test
    fun `an image with no duration is fine`() =
        runTest {
            viewModel.attach("shot.png", AttachmentType.Png, ByteArray(16), null)
            advanceUntilIdle()

            assertEquals(1, viewModel.uiState.value.attachments.size)
            assertNull(viewModel.uiState.value.error)
        }

    @Test
    fun `the eleventh file is refused`() =
        runTest {
            repeat(MAX_ATTACHMENTS) { i ->
                repo.nextKeys.addLast("support-tickets/1/f$i.png")
                viewModel.attach("f$i.png", AttachmentType.Png, ByteArray(8))
                advanceUntilIdle()
            }
            assertEquals(MAX_ATTACHMENTS, viewModel.uiState.value.attachments.size)
            val slotsUsed = repo.urlRequests

            viewModel.attach("one-too-many.png", AttachmentType.Png, ByteArray(8))
            advanceUntilIdle()

            assertEquals(MAX_ATTACHMENTS, viewModel.uiState.value.attachments.size)
            assertNotNull(viewModel.uiState.value.error)
            assertEquals(slotsUsed, repo.urlRequests, "the refused file must not ask for a slot")
        }

    // ─── SHY-0396: a second request is a CHOICE, never a refusal ───

    /**
     * Operator correction, 2026-08-21. SHY-0385 refused a second request while
     * one was still open — server 409, Send disabled, "We will reply to that
     * one." That is wrong: somebody with an open ticket may have a completely
     * different problem, and refusing them means the new problem reaches NOBODY.
     *
     * What replaces the refusal is a warning and three choices, so the person
     * decides, having been shown what they already reported:
     *
     *   - it is the problem I already reported  → added to that ticket
     *   - it is a new problem                   → a separate ticket is raised
     *   - go back                               → nothing is sent, nothing lost
     *
     * The tests below are the contract for all three, plus the two things that
     * must never happen: a blocked report, and a lost message.
     */
    @Test
    fun `what is already open is loaded as soon as the form opens`() =
        runTest {
            viewModel = formWith(BILLING)
            advanceUntilIdle()

            assertEquals(listOf(BILLING), viewModel.uiState.value.openTickets)
            assertFalse(
                viewModel.uiState.value.awaitingDuplicateChoice,
                "having an open request is not, by itself, a question — it becomes one at Send",
            )
        }

    @Test
    fun `sending while a request is open asks first rather than sending`() =
        runTest {
            viewModel = formWith(BILLING)
            advanceUntilIdle()
            viewModel.updateMessage("I was charged again today")
            viewModel.submit()
            advanceUntilIdle()

            val state = viewModel.uiState.value
            assertTrue(state.awaitingDuplicateChoice, "the person must be given the choice")
            assertTrue(repo.raiseCalls.isEmpty(), "nothing may be sent until they have chosen")
            assertTrue(repo.addCalls.isEmpty())
            assertFalse(state.submitted)
            assertEquals("I was charged again today", state.message, "their words are still theirs")
            assertNull(state.error, "being asked a question is not an error they made")
        }

    @Test
    fun `the same problem is added to the request that is already open`() =
        runTest {
            viewModel = formWith(BILLING, ACCOUNT)
            advanceUntilIdle()
            viewModel.updateMessage("  It happened again today  ")
            viewModel.submit()
            advanceUntilIdle()

            viewModel.addToOpenTicket(BILLING.ticketId)
            advanceUntilIdle()

            assertEquals(
                listOf(BILLING.ticketId to "It happened again today"),
                repo.addCalls,
                "the words go to the ticket they chose, trimmed exactly as a new one would be",
            )
            assertTrue(repo.raiseCalls.isEmpty(), "adding to a ticket must not also raise one")
            val state = viewModel.uiState.value
            assertTrue(state.submitted)
            assertTrue(state.addedToExisting, "the confirmation has to say which of the two happened")
            assertFalse(state.awaitingDuplicateChoice)
        }

    @Test
    fun `a new problem raises a separate request even though one is open`() =
        runTest {
            viewModel = formWith(BILLING)
            advanceUntilIdle()
            viewModel.updateMessage("Different thing: nobody can hear me in rooms")
            viewModel.submit()
            advanceUntilIdle()

            viewModel.sendAsNewProblem()
            advanceUntilIdle()

            assertEquals(1, repo.raiseCalls.size, "a genuinely new problem must never be blocked")
            assertEquals("Different thing: nobody can hear me in rooms", repo.raiseCalls[0].message)
            assertTrue(repo.addCalls.isEmpty())
            val state = viewModel.uiState.value
            assertTrue(state.submitted)
            assertFalse(state.addedToExisting)
            assertFalse(state.awaitingDuplicateChoice)
        }

    @Test
    fun `going back keeps every word they typed and sends nothing`() =
        runTest {
            viewModel = formWith(BILLING)
            advanceUntilIdle()
            viewModel.updateMessage("Let me re-read what I wrote")
            viewModel.submit()
            advanceUntilIdle()

            viewModel.dismissDuplicateChoice()
            advanceUntilIdle()

            val state = viewModel.uiState.value
            assertFalse(state.awaitingDuplicateChoice)
            assertEquals("Let me re-read what I wrote", state.message)
            assertTrue(repo.raiseCalls.isEmpty())
            assertTrue(repo.addCalls.isEmpty())
            assertFalse(state.submitted)
        }

    /**
     * "Go back" must not become a way to skip the question. Somebody who has
     * more to say edits their message and taps Send again — and is asked again,
     * because the request they have open has not gone anywhere.
     */
    @Test
    fun `going back and sending again asks again rather than slipping through`() =
        runTest {
            viewModel = formWith(BILLING)
            advanceUntilIdle()
            viewModel.updateMessage("First attempt")
            viewModel.submit()
            advanceUntilIdle()
            viewModel.dismissDuplicateChoice()

            viewModel.updateMessage("First attempt, with more detail")
            viewModel.submit()
            advanceUntilIdle()

            assertTrue(viewModel.uiState.value.awaitingDuplicateChoice)
            assertTrue(repo.raiseCalls.isEmpty())
        }

    @Test
    fun `with nothing open the message goes straight out, unasked`() =
        runTest {
            viewModel = formWith()
            advanceUntilIdle()
            viewModel.updateMessage("First time asking")
            viewModel.submit()
            advanceUntilIdle()

            assertEquals(1, repo.raiseCalls.size)
            assertFalse(
                viewModel.uiState.value.awaitingDuplicateChoice,
                "somebody with nothing open must never see the duplicate question",
            )
            assertTrue(viewModel.uiState.value.submitted)
        }

    /**
     * The whole point of SHY-0396 is that nothing blocks a report. A lookup that
     * fails is the app's problem, not the person's — so it costs them the
     * warning, never the ticket.
     */
    @Test
    fun `a lookup that fails never blocks somebody from reporting a problem`() =
        runTest {
            repo.openLookupFails = true
            viewModel = SupportFormViewModel(repo, SupportCategory.Other, emptyMap())
            advanceUntilIdle()
            viewModel.updateMessage("Something is broken")
            viewModel.submit()
            advanceUntilIdle()

            assertEquals(1, repo.raiseCalls.size, "a failed warning lookup must not cost a ticket")
            assertTrue(viewModel.uiState.value.submitted)
            assertTrue(
                viewModel.uiState.value.openTickets
                    .isEmpty(),
            )
        }

    @Test
    fun `adding to an open request keeps the words when it fails`() =
        runTest {
            viewModel = formWith(BILLING)
            advanceUntilIdle()
            viewModel.updateMessage("Please look again")
            viewModel.submit()
            advanceUntilIdle()

            repo.addSucceeds = false
            viewModel.addToOpenTicket(BILLING.ticketId)
            advanceUntilIdle()

            val state = viewModel.uiState.value
            assertNotNull(state.error, "a failure they can retry has to be visible")
            assertFalse(state.submitted)
            assertEquals("Please look again", state.message, "a dropped connection must never eat their words")
            assertTrue(state.awaitingDuplicateChoice, "they are still at the choice, so it stays on screen")
            assertFalse(state.isSubmitting)
        }

    @Test
    fun `after sending, the next visit knows a request is now open`() =
        runTest {
            viewModel = formWith()
            advanceUntilIdle()
            viewModel.updateMessage("My first problem")
            viewModel.submit()
            advanceUntilIdle()
            assertTrue(viewModel.uiState.value.submitted)

            viewModel.reset()
            advanceUntilIdle()

            assertEquals(
                1,
                viewModel.uiState.value.openTickets.size,
                "the ticket they just raised is open now — the next Send must ask about it",
            )
        }

    @Test
    fun `a blank message is refused on the new-problem path too`() =
        runTest {
            viewModel = formWith(BILLING)
            advanceUntilIdle()
            viewModel.updateMessage("Something")
            viewModel.submit()
            advanceUntilIdle()

            viewModel.updateMessage("   ")
            viewModel.sendAsNewProblem()
            advanceUntilIdle()

            assertTrue(repo.raiseCalls.isEmpty(), "an empty message must not reach the server by any route")
            assertNotNull(viewModel.uiState.value.error)
        }

    @Test
    fun `an over-long message is refused on the add-to-existing path too`() =
        runTest {
            viewModel = formWith(BILLING)
            advanceUntilIdle()
            viewModel.updateMessage("Something")
            viewModel.submit()
            advanceUntilIdle()

            viewModel.updateMessage("x".repeat(SUPPORT_MESSAGE_MAX_LENGTH + 1))
            viewModel.addToOpenTicket(BILLING.ticketId)
            advanceUntilIdle()

            assertTrue(repo.addCalls.isEmpty(), "the server's bound applies to both routes in")
            assertNotNull(viewModel.uiState.value.error)
        }

    @Test
    fun `tapping add twice quickly adds once`() =
        runTest {
            viewModel = formWith(BILLING)
            advanceUntilIdle()
            viewModel.updateMessage("Only once please")
            viewModel.submit()
            advanceUntilIdle()

            viewModel.addToOpenTicket(BILLING.ticketId)
            viewModel.addToOpenTicket(BILLING.ticketId)
            advanceUntilIdle()

            assertEquals(1, repo.addCalls.size)
        }

    /**
     * Found on a real phone: with four open requests the notice card grew tall
     * enough to push Send off the bottom of the form. The person most likely to
     * be in that state is the one who has already asked several times, so it is
     * exactly the wrong person to make hunt for the button.
     *
     * The FORM states the count and shows a couple of examples; the CHOICE
     * screen still shows every one, because that is where the summaries are
     * actually used to decide.
     */
    @Test
    fun `the form shows at most a couple of examples, however many are open`() =
        runTest {
            viewModel = formWith(BILLING, ACCOUNT, SAFETY, BUG)
            advanceUntilIdle()

            val shown = viewModel.uiState.value.openTicketsPreview
            assertEquals(SUPPORT_NOTICE_PREVIEW_LIMIT, shown.size)
            assertEquals(listOf(BILLING, ACCOUNT), shown, "the newest first, as the server ordered them")
            assertEquals(
                2,
                viewModel.uiState.value.openTicketsBeyondPreview,
                "the rest are counted, not silently dropped",
            )
        }

    @Test
    fun `nothing is hidden when there are only a couple open`() =
        runTest {
            viewModel = formWith(BILLING, ACCOUNT)
            advanceUntilIdle()

            assertEquals(listOf(BILLING, ACCOUNT), viewModel.uiState.value.openTicketsPreview)
            assertEquals(0, viewModel.uiState.value.openTicketsBeyondPreview)
        }

    @Test
    fun `the choice screen still offers every open request`() =
        runTest {
            viewModel = formWith(BILLING, ACCOUNT, SAFETY, BUG)
            advanceUntilIdle()
            viewModel.updateMessage("Another thing")
            viewModel.submit()
            advanceUntilIdle()

            // The preview is a FORM concern. Capping what somebody can choose
            // from would make a ticket unreachable to add to.
            assertEquals(4, viewModel.uiState.value.openTickets.size)
            assertTrue(viewModel.uiState.value.awaitingDuplicateChoice)
        }

    @Test
    fun `every open request is offered, in the order the server gave them`() =
        runTest {
            viewModel = formWith(BILLING, ACCOUNT)
            advanceUntilIdle()

            assertEquals(listOf(BILLING, ACCOUNT), viewModel.uiState.value.openTickets)
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
    // ── SHY-0424: the heading is a COUNT, not a display cap ──

    @Test
    fun `the heading states how many are OPEN, not how many are shown`() =
        runTest {
            // The defect: `mine/open` caps its summaries at five for
            // readability, and the heading was derived from that list's
            // LENGTH — so somebody with eight open requests was told five.
            val repo =
                FakeSupportRepository().apply {
                    open = (1..5).map { OpenTicketSummary("t$it", SupportCategory.Other, "s$it") }
                    serverOpenCount = 8
                }
            val vm = SupportFormViewModel(repo, SupportCategory.Other, emptyMap())
            advanceUntilIdle()

            assertEquals(8, vm.uiState.value.openRequestsTotal)
            assertEquals(5, vm.uiState.value.openTickets.size)
        }

    @Test
    fun `count and list agree when nobody is over the cap`() =
        runTest {
            val repo =
                FakeSupportRepository().apply {
                    open = listOf(OpenTicketSummary("t1", SupportCategory.Other, "s"))
                    serverOpenCount = 1
                }
            val vm = SupportFormViewModel(repo, SupportCategory.Other, emptyMap())
            advanceUntilIdle()
            assertEquals(1, vm.uiState.value.openRequestsTotal)
        }

    @Test
    fun `a count the server could not determine falls back to what is visible`() =
        runTest {
            // Narrow and deliberate: reached only when the count aggregation
            // itself failed. Saying nothing would need copy in 21 locales for
            // a case that needs a Firestore aggregate to break, so the
            // fallback is what we can actually see — never a larger guess.
            val repo =
                FakeSupportRepository().apply {
                    open = listOf(OpenTicketSummary("t1", SupportCategory.Other, "s"))
                    serverOpenCount = null
                }
            val vm = SupportFormViewModel(repo, SupportCategory.Other, emptyMap())
            advanceUntilIdle()
            assertEquals(1, vm.uiState.value.openRequestsTotal)
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

    /** What the server would say is open. Deliberately mutable — see `raiseTicket`. */
    var open: List<OpenTicketSummary> = emptyList()
    var openLookupFails = false
    val addCalls = mutableListOf<Pair<String, String>>()
    var addSucceeds = true

    /** Keys handed out in order, so a test can name the one it expects. */
    var nextKeys =
        ArrayDeque(
            listOf("support-tickets/1/a.png", "support-tickets/1/b.png") +
                (2..20).map { "support-tickets/1/k$it.png" },
        )
    var handleOrNull: (() -> UploadHandle?)? = null

    /** Keys the form asked the server to DELETE. */
    val deleteCalls = mutableListOf<String>()
    var deleteSucceeds = true

    /** Upload SLOTS requested. A refusal must not even ask for one. */
    var urlRequests = 0
    var uploadSucceeds = true
    val uploadedBytes = mutableListOf<Int>()

    override suspend fun raiseTicket(
        message: String,
        category: SupportCategory?,
        context: Map<String, String>,
        attachments: List<String>,
    ): RaiseTicketOutcome {
        raiseCalls.add(Call(message, category, context, attachments))
        val outcome = result
        // A raised ticket is OPEN from that moment. The fake mirrors the server
        // here rather than staying inert, because "the next visit knows a
        // request is now open" is otherwise unprovable without one.
        if (outcome is RaiseTicketOutcome.Raised) {
            open = open + OpenTicketSummary(outcome.ticketId, category ?: SupportCategory.Other, message)
        }
        return outcome
    }

    /**
     * How many the SERVER says are open, independent of how many this fake
     * lists (SHY-0424). Defaults to agreeing with the list; a test that wants
     * the over-the-cap case sets it higher.
     */
    var serverOpenCount: Int? = null

    override suspend fun openTickets(): OpenTicketsView? =
        if (openLookupFails) {
            null
        } else {
            OpenTicketsView(summaries = open, openCount = serverOpenCount ?: open.size)
        }

    override suspend fun addToTicket(
        ticketId: String,
        message: String,
    ): Boolean {
        addCalls.add(ticketId to message)
        return addSucceeds
    }

    override suspend fun deleteAttachment(r2Key: String): Boolean {
        deleteCalls.add(r2Key)
        return deleteSucceeds
    }

    override suspend fun requestAttachmentUpload(contentType: AttachmentType): UploadHandle? {
        urlRequests++
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
