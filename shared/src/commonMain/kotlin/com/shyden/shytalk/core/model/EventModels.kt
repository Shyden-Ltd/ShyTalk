package com.shyden.shytalk.core.model

/**
 * Scheduled events with a roster of performers (SHY-0267, j16).
 *
 * WHY THE FEATURE EXISTS. A showcase with four performers where the tips all
 * land on the host is not a rounding error — it is the performers being paid
 * nothing for the audience they drew. An event is one room that several people
 * pass through, and the seat is what says who is performing right now, so the
 * money can follow whoever is actually on stage.
 *
 * These models mirror the Express API's shapes exactly. They are deliberately
 * plain data with no Firestore types anywhere: the app reaches the backend ONLY
 * through the API, so nothing here should know what a DocumentSnapshot is.
 */

enum class EventState {
    SCHEDULED,
    LIVE,
    CLOSED,
    ;

    companion object {
        /**
         * Unknown wire values fall back to SCHEDULED rather than throwing.
         *
         * A server that grows a fourth state should not crash an installed app
         * on the way past. SCHEDULED is the safe landing: it shows the event
         * without offering controls that only make sense once it is live.
         */
        fun fromWire(value: String?): EventState = entries.firstOrNull { it.name.equals(value?.trim(), ignoreCase = true) } ?: SCHEDULED
    }
}

enum class InviteStatus {
    PENDING,
    ACCEPTED,
    DECLINED,
    ;

    companion object {
        fun fromWire(value: String?): InviteStatus = entries.firstOrNull { it.name.equals(value?.trim(), ignoreCase = true) } ?: PENDING
    }
}

/** An event as the host home and the performer's list see it. */
data class ScheduledEvent(
    val eventId: String = "",
    val title: String = "",
    val hostId: String = "",
    /** ISO-8601, as the API sends it. */
    val startsAt: String = "",
    val durationMin: Int = 60,
    val state: EventState = EventState.SCHEDULED,
    val roster: List<String> = emptyList(),
    /** Present once the event has started and bound a room. */
    val roomId: String? = null,
    /** Who is on the performer seat right now; null between acts. */
    val currentPerformerId: String? = null,
    /** Per-member answers to the invite, keyed by uniqueId. */
    val rosterStates: Map<String, InviteStatus> = emptyMap(),
)

/** An invite still waiting on an answer, with everything the banner needs. */
data class EventInvite(
    val eventId: String = "",
    val title: String = "",
    val hostId: String = "",
    /**
     * The host's display name, so the banner can say "You are scheduled in
     * Tariq's event" without a second call. A banner that fetches to draw one
     * line renders half-empty first.
     */
    val hostName: String = "",
    val startsAt: String = "",
    val status: InviteStatus = InviteStatus.PENDING,
    val state: EventState = EventState.SCHEDULED,
    /** Set once the event is live — this is what the "join" link opens. */
    val roomId: String? = null,
)

/** What one performer earned in one event. */
data class PerformerEarnings(
    val uniqueId: String = "",
    val giftCount: Int = 0,
    val coinTotal: Long = 0,
    val beanTotal: Long = 0,
)

/**
 * The closing (or live) picture of an event.
 *
 * [perPerformer] is the point. One total tells the host what the night made and
 * tells each performer nothing about what THEY earned — which is the silence the
 * whole feature exists to end. A performer who earned nothing appears at zero
 * rather than being absent: absent and zero are different facts.
 */
data class EventSummary(
    val eventId: String = "",
    val giftCount: Int = 0,
    val coinTotal: Long = 0,
    val beanTotal: Long = 0,
    val topContributorId: String? = null,
    val topContributorCoins: Long = 0,
    val perPerformer: List<PerformerEarnings> = emptyList(),
) {
    /** This viewer's own line, or null when they did not perform. */
    fun earningsFor(uniqueId: String?): PerformerEarnings? =
        if (uniqueId.isNullOrBlank()) null else perPerformer.firstOrNull { it.uniqueId == uniqueId }
}
