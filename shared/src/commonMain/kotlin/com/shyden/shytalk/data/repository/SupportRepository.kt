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
}

/**
 * What somebody may attach. Mirrors `ATTACHMENT_CONTENT_TYPES` in
 * `express-api/src/routes/support-tickets.js` — a type here the server does not
 * know is an upload that is refused after the person has already chosen the file.
 */
enum class AttachmentType(
    val wireValue: String,
) {
    Jpeg("image/jpeg"),
    Png("image/png"),
    Webp("image/webp"),
    Mp4("video/mp4"),
    QuickTime("video/quicktime"),
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
}

/**
 * A TYPED outcome rather than `Resource<String>`.
 *
 * `Resource.Error` carries only a message, so telling "you already have an open
 * request" apart from "the network failed" would mean matching the server's
 * English text. That breaks the moment the server rewords it, and it was never
 * going to work for somebody reading the app in another language. The one case
 * the UI must treat differently gets its own case.
 */
sealed interface RaiseTicketOutcome {
    data class Raised(
        val ticketId: String,
    ) : RaiseTicketOutcome

    /** The person already has an open request; a second would be a duplicate. */
    data object AlreadyOpen : RaiseTicketOutcome

    data class Failed(
        val message: String,
    ) : RaiseTicketOutcome
}
