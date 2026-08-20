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
    ): RaiseTicketOutcome
}

/**
 * Categories exist to help an admin triage, so the set is closed and mirrors the
 * server-side allowlist in `express-api/src/routes/support-tickets.js`.
 */
enum class SupportCategory(
    val wireValue: String,
) {
    Age("age"),
    Account("account"),
    Payment("payment"),
    Safety("safety"),
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
