package com.shyden.shytalk.feature.support

import androidx.lifecycle.ViewModel
import androidx.lifecycle.viewModelScope
import com.shyden.shytalk.core.util.UiText
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.core.util.logW
import com.shyden.shytalk.data.repository.AttachmentType
import com.shyden.shytalk.data.repository.OpenTicketSummary
import com.shyden.shytalk.data.repository.RaiseTicketOutcome
import com.shyden.shytalk.data.repository.SupportCategory
import com.shyden.shytalk.data.repository.SupportRepository
import com.shyden.shytalk.resources.Res
import com.shyden.shytalk.resources.support_form_error_attachment_failed
import com.shyden.shytalk.resources.support_form_error_attachment_too_many
import com.shyden.shytalk.resources.support_form_error_attachment_type
import com.shyden.shytalk.resources.support_form_error_empty
import com.shyden.shytalk.resources.support_form_error_generic
import com.shyden.shytalk.resources.support_form_error_image_too_large
import com.shyden.shytalk.resources.support_form_error_too_long
import com.shyden.shytalk.resources.support_form_error_video_too_long
import com.shyden.shytalk.resources.support_form_error_video_unreadable
import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update
import kotlinx.coroutines.launch

private const val TAG = "SupportForm"

/**
 * How long a support message may be — operator 2026-08-22, was 2,000.
 *
 * Mirrors `MAX_MESSAGE_LENGTH` in `routes/support-tickets.js`; the two must
 * agree or somebody is refused by a server bound the app never warned them
 * about, after they have written the whole thing.
 *
 * Shown as a LIVE count on the form. A bound somebody only discovers when they
 * press Send is a bound that costs them the message they just wrote.
 */
const val SUPPORT_MESSAGE_MAX_LENGTH = 1000

/** Mirrors `MAX_ATTACHMENTS` in `routes/support-tickets.js`. */
const val MAX_ATTACHMENTS = 10

/**
 * How large a still image may be — SHY-0387, corrected by the operator on
 * 2026-08-22 (was one flat 25 MB cap over images AND video).
 *
 * Checked BEFORE the bytes leave the device. The alternative is a file that
 * uploads for two minutes on a phone connection and then fails, which costs the
 * person their data allowance and tells them nothing they could have acted on.
 *
 * SHY-0420 set the number at 10 MB. It mirrors `MAX_IMAGE_BYTES` in
 * `express-api/src/utils/attachment-limits.js`, which is where it is ENFORCED —
 * this copy exists so somebody is told early, not so the limit depends on the
 * client honouring it.
 */
const val MAX_IMAGE_BYTES = 10 * 1024 * 1024

/**
 * How LONG a video may be. Duration, deliberately — not bytes.
 *
 * A 30-second clip from a modern phone camera can be 100 MB; a three-minute
 * screen recording can be 4 MB. Bounding video by size therefore refuses
 * exactly the wrong files: it turns away the short, useful clip and waves
 * through the long one nobody will watch. The operator asked for 30 seconds,
 * which is a statement about the ADMIN's time, not about storage.
 */
const val MAX_VIDEO_DURATION_MS = 30_000L

/**
 * How many open requests the FORM lists before it stops naming them.
 *
 * Found on a real phone: with four open requests the notice card grew tall
 * enough to push Send off the bottom of the form. The person in that state is
 * the one who has already asked several times, which makes them exactly the
 * wrong person to send hunting for the button.
 *
 * The choice screen is deliberately NOT capped -- capping what somebody can
 * choose from would make a ticket impossible to add to.
 */
const val SUPPORT_NOTICE_PREVIEW_LIMIT = 2

/**
 * Something the person attached and the server has accepted the bytes for.
 *
 * [displayName] is theirs — the file they picked — so the list reads as the
 * things they chose. [r2Key] is the server's, and is what travels with the
 * ticket; it is never shown.
 */
data class PendingAttachment(
    val displayName: String,
    val r2Key: String,
)

data class SupportFormUiState(
    val message: String = "",
    /**
     * Never absent. Every entry point knows why somebody is there — the age gate
     * on Lucky Spin, the age gate on private messages, or the general route from
     * settings — so nobody is asked to categorise their own problem.
     */
    val category: SupportCategory = SupportCategory.Other,
    val isSubmitting: Boolean = false,
    val submitted: Boolean = false,
    /**
     * True when [submitted] was reached by adding to a request that was already
     * open rather than by raising a new one — SHY-0396. The confirmation has to
     * say which of the two happened, or somebody who chose "it is the problem I
     * already reported" is told we have a new message and cannot tell where it
     * went.
     */
    val addedToExisting: Boolean = false,
    /**
     * The person's own requests that are still open, newest lookup wins.
     *
     * Empty is the ordinary case AND the case where the lookup failed — see
     * [SupportFormViewModel.refreshOpenTickets] for why that collapse is
     * deliberate rather than sloppy.
     */
    val openTickets: List<OpenTicketSummary> = emptyList(),
    /**
     * How many requests are actually open, which is NOT [openTickets].size —
     * that list is capped for readability (SHY-0424). Null when the server
     * could not determine it; see [openRequestsTotal].
     */
    val openTicketCount: Int? = null,
    /**
     * The three-choice screen is up: they pressed Send, they have something
     * open, and nothing has been sent yet.
     *
     * NOT an [error]. Being asked a question is not a mistake they made, and the
     * distinction is what lets "Go back" leave every word intact.
     */
    val awaitingDuplicateChoice: Boolean = false,
    /**
     * True once somebody on the report guide chose to raise a ticket anyway —
     * SHY-0437.
     *
     * Reset whenever the category changes and whenever the page is left, so it
     * never hides the guide from somebody who has not read it. Passing through
     * "Safety" on the way to another option is not the same as reading a guide.
     */
    val reportGuideBypassed: Boolean = false,
    /** Uploaded and ready to travel with the ticket, in the order they were added. */
    val attachments: List<PendingAttachment> = emptyList(),
    val isAttaching: Boolean = false,
    val error: UiText? = null,
) {
    /**
     * Show the guide instead of the message form — SHY-0437.
     *
     * "Safety & another user" is the one category that does not lead straight to
     * the form. The support queue is not a reporting system: a report raised
     * there carries no reportedUserId, is not triaged by urgency, cannot be
     * counted toward a repeat pattern, and is answered by whoever picks up
     * support rather than by moderation. Somebody in genuine distress picks the
     * option that says "Safety" and gets the least effective route we have.
     *
     * Derived rather than stored, so there is one answer and no second copy of
     * it to fall out of step.
     */
    val showReportGuide: Boolean
        get() = category == SupportCategory.Safety && !reportGuideBypassed

    /**
     * How many characters are in the field right now.
     *
     * Counted on the RAW value, not the trimmed one: somebody typing spaces has
     * used those characters and the field is holding them, so a count that
     * disagreed with what is on screen would be worse than no count at all.
     */
    val characterCount: Int
        get() = message.length

    /** True once the field holds more than the server will take. */
    val isOverCharacterLimit: Boolean
        get() = characterCount > SUPPORT_MESSAGE_MAX_LENGTH

    /** What the FORM names, at most [SUPPORT_NOTICE_PREVIEW_LIMIT] of them. */
    val openTicketsPreview: List<OpenTicketSummary>
        get() = openTickets.take(SUPPORT_NOTICE_PREVIEW_LIMIT)

    /**
     * How many are open beyond the ones named. Counted rather than dropped: a
     * silent truncation would tell somebody with five open requests that they
     * have two.
     */
    val openTicketsBeyondPreview: Int
        get() = (openTickets.size - SUPPORT_NOTICE_PREVIEW_LIMIT).coerceAtLeast(0)

    /**
     * The number to put in "You already have N requests open".
     *
     * The server's count when it has one; otherwise what we can actually see.
     * The fallback is imperfect and deliberately narrow: it is reached only
     * when the count aggregation itself failed, and saying nothing at all
     * would need copy in 21 locales for a case that requires a Firestore
     * aggregate to break. Recorded in SHY-0424 rather than left silent.
     */
    val openRequestsTotal: Int
        get() = openTicketCount ?: openTickets.size
}

/**
 * The in-app support form — SHY-0385.
 *
 * The behaviour that matters here is what happens when sending FAILS. Somebody
 * raising a support ticket is already having a bad time; losing what they wrote
 * to a dropped connection is the worst thing this screen can do. So the message
 * is never cleared on failure, and a retry re-sends what is still on screen.
 */
class SupportFormViewModel(
    private val supportRepository: SupportRepository,
    initialCategory: SupportCategory,
    private val context: Map<String, String>,
) : ViewModel() {
    private val _uiState = MutableStateFlow(SupportFormUiState(category = initialCategory))
    val uiState: StateFlow<SupportFormUiState> = _uiState.asStateFlow()

    init {
        // Fetched on OPEN rather than on Send, so the round trip happens while
        // the person is still typing and the choice screen appears instantly.
        refreshOpenTickets()
    }

    /**
     * Ask what this person still has open — SHY-0396.
     *
     * A lookup that FAILS is treated as "nothing open", which is the safe
     * collapse: the worst case is a duplicate ticket, and the alternative —
     * blocking, or asking a question with no summaries to answer it against —
     * costs somebody their report. It is logged, so "the warning never appears"
     * is a question the logs can answer.
     */
    private fun refreshOpenTickets() {
        viewModelScope.launch {
            val open = supportRepository.openTickets()
            if (open == null) {
                logW(TAG, "Could not look up open tickets; sending without the duplicate warning")
                _uiState.update { it.copy(openTickets = emptyList(), openTicketCount = null) }
            } else {
                _uiState.update {
                    it.copy(openTickets = open.summaries, openTicketCount = open.openCount)
                }
            }
        }
    }

    /**
     * Back to a blank form, keeping the entry point's category.
     *
     * This ViewModel is scoped to the SCREEN, not to the dialog — closing the
     * dialog does not destroy it. Without this, re-opening support after a
     * successful send re-attached the same instance with `submitted = true`, so
     * the person got the "we have your request" confirmation instead of a form
     * and could not raise a second ticket without leaving the screen entirely.
     *
     * Called on dismissal rather than on open: both land before the next
     * recomposition, so nobody sees a blank form flash over the confirmation.
     */
    fun selectCategory(category: SupportCategory) {
        // The bypass belongs to one visit to the guide, not to the session.
        _uiState.update { it.copy(category = category, reportGuideBypassed = false) }
    }

    /**
     * "I read it and I still could not report" — SHY-0437.
     *
     * The escape hatch, and it is not optional. Somebody who cannot make the
     * report — the person blocked them, the message is gone, the interface
     * defeated them — must not be left with nowhere to go. They raise a ticket
     * and an admin files the report for them (SHY-0438).
     *
     * The category stays Safety: what they are telling us about has not changed
     * because the guide did not work for them.
     */
    fun contactSupportAnyway() {
        _uiState.update { it.copy(reportGuideBypassed = true) }
    }

    /**
     * Take a file the person picked, upload it, and list it — SHY-0387.
     *
     * The size bound is checked FIRST, so an oversized video never leaves the
     * device. Everything after that can fail, and every failure path says so:
     * a file that did not upload is not added to the list, because a list entry
     * for a file the server never received is a ticket that references nothing.
     */
    fun attach(
        displayName: String,
        contentType: AttachmentType,
        bytes: ByteArray,
        durationMs: Long? = null,
    ) {
        val state = _uiState.value
        // The count is checked FIRST: with ten already attached nothing can be
        // added, whatever is wrong with the eleventh file, and "you can attach
        // up to 10 files" is the only message they can act on.
        if (state.attachments.size >= MAX_ATTACHMENTS) {
            _uiState.update { it.copy(error = UiText.res(Res.string.support_form_error_attachment_too_many)) }
            return
        }
        refusalFor(contentType, bytes, durationMs)?.let { reason ->
            logW(TAG, "Attachment refused: ${contentType.wireValue}, ${bytes.size}B, ${durationMs}ms")
            _uiState.update { it.copy(error = reason) }
            return
        }

        _uiState.update { it.copy(isAttaching = true, error = null) }

        viewModelScope.launch {
            val handle = supportRepository.requestAttachmentUpload(contentType)
            if (handle == null) {
                logW(TAG, "Attachment upload URL refused for $contentType")
                _uiState.update {
                    it.copy(isAttaching = false, error = UiText.res(Res.string.support_form_error_attachment_failed))
                }
                return@launch
            }

            val uploaded = supportRepository.uploadAttachment(handle.uploadUrl, contentType, bytes)
            if (uploaded) {
                _uiState.update {
                    it.copy(
                        isAttaching = false,
                        attachments = it.attachments + PendingAttachment(displayName, handle.r2Key),
                    )
                }
            } else {
                logW(TAG, "Attachment upload failed for $displayName")
                _uiState.update {
                    it.copy(isAttaching = false, error = UiText.res(Res.string.support_form_error_attachment_failed))
                }
            }
        }
    }

    /**
     * Why this file cannot be attached, or null if it can — SHY-0387.
     *
     * Images are bounded by SIZE, video by DURATION. Every refusal names the
     * actual limit, because "that file cannot be attached" leaves somebody
     * guessing which of several rules they broke.
     */
    private fun refusalFor(
        contentType: AttachmentType,
        bytes: ByteArray,
        durationMs: Long?,
    ): UiText? =
        when {
            !contentType.isVideo ->
                if (bytes.size > MAX_IMAGE_BYTES) {
                    UiText.res(Res.string.support_form_error_image_too_large)
                } else {
                    null
                }

            // Unknown duration means the rule CANNOT be honoured. Refused with
            // its own sentence rather than borrowing the too-long one: telling
            // somebody a video is too long when it was never measured is a lie
            // they cannot act on.
            durationMs == null -> UiText.res(Res.string.support_form_error_video_unreadable)

            durationMs > MAX_VIDEO_DURATION_MS -> UiText.res(Res.string.support_form_error_video_too_long)

            else -> null
        }

    /**
     * The person picked a file the server will not accept.
     *
     * Refused before any upload starts, so nobody spends a video's worth of
     * mobile data to be told no at the end. Separate from [attach] because
     * nothing is uploaded here — there is no in-flight state to enter.
     */
    fun refuseAttachmentType() {
        _uiState.update {
            it.copy(error = UiText.res(Res.string.support_form_error_attachment_type))
        }
    }

    /**
     * Take a file off the form, and off the SERVER — SHY-0434.
     *
     * This replaces a comment that documented the leak as deliberate: "the
     * object stays in R2 unreferenced... unreferenced objects are the storage
     * lifecycle's problem". No lifecycle ever collected them, and the race it
     * worried about — a delete stripping an attachment off a ticket already on
     * its way — cannot happen here, because removing the key from the form is
     * what stops any later send from referencing it.
     *
     * The bytes went up the moment the file was picked, before Send. So this is
     * not only a screen change: once the form drops the key nothing references
     * that object, no ticket carries it, and no retention rule or erasure
     * request will ever reach it.
     *
     * The form lets go FIRST and unconditionally. Somebody who has decided
     * against a file must not be stuck with it because the server is having a
     * bad day — and this screen exists for people already having one. A delete
     * that fails is logged, not surfaced: there is nothing they could do about
     * it, and it does not change what gets sent.
     */
    fun removeAttachment(r2Key: String) {
        _uiState.update { it.copy(attachments = it.attachments.filterNot { a -> a.r2Key == r2Key }) }
        viewModelScope.launch {
            if (!supportRepository.deleteAttachment(r2Key)) {
                logW(TAG, "Removed attachment was not deleted from storage: $r2Key")
            }
        }
    }

    fun reset() {
        // Read before the update, because the update erases it.
        val hadJustSent = _uiState.value.submitted
        _uiState.update {
            when {
                // A send in flight keeps its state. The page cannot be left while
                // one is running, so this is defensive rather than reachable.
                it.isSubmitting -> it

                // Already sent: start clean. Keeping the text would show somebody
                // their own sent message as though it were an unsent draft.
                //
                // `openTickets` is dropped with the rest and re-fetched below,
                // because the request they just raised is open NOW -- a stale
                // empty list would let the very next Send skip the warning.
                it.submitted -> SupportFormUiState(category = it.category)

                // Left WITHOUT sending: the words are still theirs. A back-press
                // is easy to hit by accident, and this screen is reached by people
                // who are already having a bad time -- SHY-0385's rule about never
                // losing what somebody typed applies here too, not only to a
                // failed send. Only the transient states clear.
                // SHY-0437: the guide bypass is transient too. It belongs to one
                // visit -- the ViewModel outlives this page, and a bypass that
                // survived would silently skip the guide on the next visit for
                // somebody who has not read it.
                else ->
                    it.copy(
                        error = null,
                        awaitingDuplicateChoice = false,
                        reportGuideBypassed = false,
                    )
            }
        }
        // Only after a send. The request they just raised is open NOW, and this
        // ViewModel outlives the page -- a stale empty list would let the very
        // next Send skip the warning entirely.
        if (hadJustSent) refreshOpenTickets()
    }

    fun updateMessage(value: String) {
        // Typing clears a previous complaint: the person is already acting on it,
        // and leaving the error up reads as though it applies to the new text.
        _uiState.update { it.copy(message = value, error = null) }
    }

    /**
     * What both routes out of this form have to agree on, in one place.
     *
     * Returns the message that would be SENT, or null having already put the
     * reason on screen. Shared rather than duplicated because SHY-0396 added a
     * second and a third way to send: bounds enforced on only one of them is a
     * message the server refuses after the person thought it had gone.
     */
    private fun validatedMessage(): String? {
        val state = _uiState.value
        if (state.isSubmitting) return null // Double-tap sends once.

        val trimmed = state.message.trim()
        if (trimmed.isEmpty()) {
            _uiState.update { it.copy(error = UiText.res(Res.string.support_form_error_empty)) }
            return null
        }
        if (trimmed.length > SUPPORT_MESSAGE_MAX_LENGTH) {
            // Bounded, never silently truncated -- cutting somebody's message in
            // half loses the part they cared about and tells them nothing.
            //
            // Measured on `trimmed`, because `trimmed` is what gets sent and what
            // the server bounds. Measuring the raw field instead refused a message
            // that would have been accepted, purely for trailing whitespace.
            _uiState.update { it.copy(error = UiText.res(Res.string.support_form_error_too_long)) }
            return null
        }
        return trimmed
    }

    /**
     * Send — or, if they already have a request open, ASK first.
     *
     * SHY-0396: this used to send unconditionally and let the server answer 409.
     * That refusal meant a genuinely different problem reached nobody. The
     * question is asked here instead, before anything is sent, and it is asked
     * every time Send is pressed while something is open — "go back" is a way to
     * re-read what you wrote, never a way to skip the question.
     */
    fun submit() {
        val trimmed = validatedMessage() ?: return
        if (_uiState.value.openTickets.isNotEmpty()) {
            _uiState.update { it.copy(awaitingDuplicateChoice = true, error = null) }
            return
        }
        raise(trimmed)
    }

    /** "It is a new problem" — they have seen what is open and this is not it. */
    fun sendAsNewProblem() {
        val trimmed = validatedMessage() ?: return
        _uiState.update { it.copy(awaitingDuplicateChoice = false) }
        raise(trimmed)
    }

    /**
     * "It is the problem I already reported" — their words join that ticket.
     *
     * The alternative considered and rejected was raising a linked duplicate.
     * That is what the operator asked us to stop: a duplicate for the same
     * problem only moves them to the back of the queue.
     */
    fun addToOpenTicket(ticketId: String) {
        val trimmed = validatedMessage() ?: return

        _uiState.update { it.copy(isSubmitting = true, error = null) }
        viewModelScope.launch {
            if (supportRepository.addToTicket(ticketId, trimmed)) {
                logI(TAG, "Added to an open support ticket: $ticketId")
                _uiState.update {
                    it.copy(
                        isSubmitting = false,
                        submitted = true,
                        addedToExisting = true,
                        awaitingDuplicateChoice = false,
                    )
                }
            } else {
                logW(TAG, "Could not add to open support ticket: $ticketId")
                // The choice stays up and the text stays in the field, so the
                // retry is one tap and costs them nothing.
                _uiState.update {
                    it.copy(
                        isSubmitting = false,
                        error = UiText.res(Res.string.support_form_error_generic),
                    )
                }
            }
        }
    }

    /** "Go back" — nothing is sent and nothing is lost. */
    fun dismissDuplicateChoice() {
        _uiState.update { it.copy(awaitingDuplicateChoice = false) }
    }

    private fun raise(trimmed: String) {
        val state = _uiState.value
        _uiState.update { it.copy(isSubmitting = true, error = null) }

        viewModelScope.launch {
            val outcome =
                supportRepository.raiseTicket(
                    trimmed,
                    state.category,
                    // SHY-0437's acceptance signal is the RATIO of people who go
                    // on to report against people who raise a ticket anyway.
                    // Without this the ratio cannot be computed at all, and
                    // "does the guide work" stays an opinion.
                    if (state.reportGuideBypassed) {
                        context + ("raisedAfterReportGuide" to "true")
                    } else {
                        context
                    },
                    state.attachments.map { it.r2Key },
                )
            when (outcome) {
                is RaiseTicketOutcome.Raised -> {
                    logI(TAG, "Support ticket raised: ${outcome.ticketId}")
                    _uiState.update { it.copy(isSubmitting = false, submitted = true) }
                }

                is RaiseTicketOutcome.Failed -> {
                    // The person sees one plain sentence — the server's wording is
                    // English and would be unreadable to most of the people who hit
                    // this. It still has to reach the log, or "support tickets are
                    // not sending" is a report with no evidence behind it.
                    logW(TAG, "Support ticket failed: ${outcome.message}")
                    // The typed message is deliberately left in place so a retry
                    // costs nothing. `it.copy` keeps it; clearing it here is the bug.
                    _uiState.update {
                        it.copy(
                            isSubmitting = false,
                            error = UiText.res(Res.string.support_form_error_generic),
                        )
                    }
                }
            }
        }
    }
}
