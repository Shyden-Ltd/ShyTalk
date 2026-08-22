package com.shyden.shytalk.data.repository

/**
 * Raising a support ticket from inside the app — SHY-0385.
 *
 * The queue and its admin surface are SHY-0380. This is the way in.
 *
 * Operator decision, 2026-08-20: support is a ticket an admin actions, not an
 * email. There is no support mailbox, so every other "contact us" route in the
 * product eventually points here.
 */
interface SupportRepository {
    suspend fun raiseTicket(
        message: String,
        category: SupportCategory?,
        context: Map<String, String>,
        attachments: List<String> = emptyList(),
    ): RaiseTicketOutcome

    /**
     * Step 1 of attaching a screenshot or video — SHY-0387.
     *
     * The API issues a short-lived signed PUT URL and the key it belongs to. The
     * `r2Key` must be handed back to [raiseTicket] verbatim: it encodes the
     * caller's own prefix and the server validates it against the token, so a
     * key that has been "tidied up" client-side is a key the server refuses.
     *
     * Same flow as age verification, deliberately. The API never carries the
     * bytes and the client never holds a long-lived storage credential.
     */
    suspend fun requestAttachmentUpload(contentType: AttachmentType): UploadHandle?

    /**
     * Step 2 — PUT the bytes straight to the signed URL. No auth header; the URL
     * is the authorisation. A failure here is expiry or network, not identity.
     */
    suspend fun uploadAttachment(
        uploadUrl: String,
        contentType: AttachmentType,
        bytes: ByteArray,
    ): Boolean

    /**
     * Delete an upload the person has taken off their form — SHY-0434.
     *
     * The bytes go up the moment a file is PICKED, before Send is pressed, so a
     * removed file is already in storage. Once the form drops the key nothing
     * references it: no ticket carries it, so no retention rule and no erasure
     * request will ever reach it.
     *
     * That matters here more than storage cost. People attach screenshots of
     * private conversations and video of other people to safety reports, and
     * taking a file off the form is the moment somebody most reasonably
     * believes it is gone.
     *
     * `false` means the server did not delete it. The caller still removes it
     * from the form — refusing to let go of a file somebody has decided against
     * would leave them unable to send at all — but the failure is logged rather
     * than treated as success.
     */
    suspend fun deleteAttachment(r2Key: String): Boolean

    /**
     * The caller's own requests that are still open — SHY-0396.
     *
     * `null` means the lookup FAILED and is deliberately distinct from an empty
     * list. The two lead to the same screen but not to the same reasoning: empty
     * means "you have nothing open", failed means "we could not find out". A
     * failed lookup must never cost somebody their ticket, so the caller sends
     * anyway — but it says so in the log rather than pretending it knew.
     */
    suspend fun openTickets(): List<OpenTicketSummary>?

    /**
     * Add to a request the caller already has — SHY-0396, the "it is the problem
     * I already reported" choice.
     *
     * Without this the typed message has nowhere to go, and dropping it is the
     * worst possible outcome for somebody who has had to ask twice.
     */
    suspend fun addToTicket(
        ticketId: String,
        message: String,
    ): Boolean
}

/**
 * One of the caller's own open requests, as offered by the choice screen.
 *
 * [summary] is a shortened copy of their OWN words, produced by the server. It
 * is what makes the question answerable: "is this the same problem?" cannot be
 * answered against a ticket id.
 */
data class OpenTicketSummary(
    val ticketId: String,
    val category: SupportCategory,
    val summary: String,
)

/**
 * What somebody may attach. Mirrors `ATTACHMENT_CONTENT_TYPES` in
 * `express-api/src/routes/support-tickets.js` — a type here the server does not
 * know is an upload that is refused after the person has already chosen the file.
 */
enum class AttachmentType(
    val wireValue: String,
    /**
     * Whether this is moving pictures — SHY-0387's corrected limits.
     *
     * A property rather than a `startsWith("video/")` at each call site: an
     * image is bounded by SIZE and a video by DURATION, so every caller has to
     * make this distinction, and a string test repeated in three places is
     * three chances to get it wrong.
     */
    val isVideo: Boolean,
) {
    Jpeg("image/jpeg", isVideo = false),
    Png("image/png", isVideo = false),
    Webp("image/webp", isVideo = false),
    Mp4("video/mp4", isVideo = true),
    QuickTime("video/quicktime", isVideo = true),
    ;

    companion object {
        /**
         * What the picker handed back, or `null` if the server would refuse it.
         *
         * Refusing HERE is the point: the alternative is asking for an upload
         * slot, uploading, and being refused at the end, which costs somebody a
         * video's worth of mobile data to be told no.
         *
         * Matched case-insensitively and without parameters, because a platform
         * may answer `image/jpeg; charset=binary` or `IMAGE/JPEG`.
         */
        fun fromContentType(raw: String?): AttachmentType? {
            val bare = raw?.substringBefore(';')?.trim()?.lowercase() ?: return null
            return entries.firstOrNull { it.wireValue == bare }
        }
    }
}

data class UploadHandle(
    val uploadUrl: String,
    val r2Key: String,
    val expiresInSec: Int,
)

/**
 * Categories exist to help an admin triage, so the set is closed and mirrors the
 * server-side allowlist in `express-api/src/routes/support-tickets.js`.
 *
 * Declaration order is the order they are OFFERED — SHY-0387's approved set,
 * with the honest catch-all last. `Bug` is "Something is broken".
 */
enum class SupportCategory(
    val wireValue: String,
) {
    Account("account"),
    Age("age"),
    Payment("payment"),
    Safety("safety"),
    Bug("bug"),
    Other("other"),
    ;

    companion object {
        /**
         * A category coming BACK from the server — SHY-0396.
         *
         * Falls back to [Other] rather than throwing: a ticket raised by a newer
         * build under a category this one does not know is still a ticket the
         * person needs to recognise, and a crash on the choice screen would take
         * away the only route to support.
         */
        fun fromWire(raw: String?): SupportCategory = entries.firstOrNull { it.wireValue == raw } ?: Other
    }
}

/**
 * A TYPED outcome rather than `Resource<String>`.
 *
 * `Resource.Error` carries only a message, so distinguishing one failure from
 * another would mean matching the server's English text — which breaks the
 * moment the server rewords it, and was never going to work for somebody
 * reading the app in another language.
 *
 * There was a third case, `AlreadyOpen`, mapped from the server's 409. SHY-0396
 * deleted it along with the 409: a second request is never refused now, so the
 * case was unreachable, and an unreachable branch in a sealed interface is a
 * trap for whoever reads it next. Having a request open is a QUESTION the form
 * asks before sending, not an outcome of having sent.
 */
sealed interface RaiseTicketOutcome {
    data class Raised(
        val ticketId: String,
    ) : RaiseTicketOutcome

    data class Failed(
        val message: String,
    ) : RaiseTicketOutcome
}
