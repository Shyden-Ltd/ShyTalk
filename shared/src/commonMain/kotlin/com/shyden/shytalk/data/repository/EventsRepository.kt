package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.EventInvite
import com.shyden.shytalk.core.model.EventSummary
import com.shyden.shytalk.core.model.ScheduledEvent
import com.shyden.shytalk.core.util.Resource

/**
 * Events, reached ONLY through the Express API.
 *
 * No Firestore anywhere in this file or its implementation — not as an
 * optimisation, as the rule: the API is the single place that decides who may do
 * what, and a client that reads the database directly is asking the client-side
 * rules to be that arbiter instead.
 *
 * ONE implementation serves both phones. The existing repositories are written
 * twice — once in `app/src/main` against `WorkerApiClient`, once in `iosMain`
 * against `IosApiClient` — because the two clients return different JSON types
 * despite having the same method names. That duplication is why the two
 * platforms drift; here the platform supplies raw JSON text ([EventsApi]) and
 * every decision above that line is shared.
 */
interface EventsRepository {
    /** Events I host and events I am rostered in — deliberately separate. */
    data class MyEvents(
        val hosting: List<ScheduledEvent> = emptyList(),
        val performing: List<ScheduledEvent> = emptyList(),
    )

    suspend fun myEvents(): Resource<MyEvents>

    /** Invites still waiting on an answer, for the banner. */
    suspend fun pendingInvites(): Resource<List<EventInvite>>

    suspend fun schedule(
        title: String,
        startsAtIso: String,
        durationMin: Int,
        roster: List<String>,
    ): Resource<ScheduledEvent>

    suspend fun acceptInvite(eventId: String): Resource<Unit>

    suspend fun declineInvite(eventId: String): Resource<Unit>

    suspend fun event(eventId: String): Resource<ScheduledEvent>

    /** Goes LIVE and binds a room; returns the room to open. */
    suspend fun start(eventId: String): Resource<String>

    suspend fun promote(
        eventId: String,
        uniqueId: String,
    ): Resource<Unit>

    suspend fun demote(
        eventId: String,
        uniqueId: String,
    ): Resource<Unit>

    suspend fun summary(eventId: String): Resource<EventSummary>

    /** Retires the event AND its room, and freezes the closing summary. */
    suspend fun close(eventId: String): Resource<EventSummary>

    suspend fun addToRoster(uniqueId: String): Resource<Unit>

    suspend fun removeFromRoster(uniqueId: String): Resource<Unit>
}

/**
 * The one platform-specific piece: authenticated JSON over HTTP.
 *
 * Deliberately tiny — raw request/response text, no parsing — so each platform's
 * implementation is a few lines delegating to the API client it already has, and
 * every decision about what the JSON MEANS stays in shared code where it can
 * only be written once.
 *
 * Implementations must throw on transport failure rather than returning an empty
 * body: an empty string is indistinguishable from a legitimately empty response,
 * and the repository would report "no events" for "the network is down".
 */
interface EventsApi {
    /** GET the path, returning the raw response body. */
    suspend fun getJson(path: String): String

    /** POST [body] (already JSON, or null for an empty body). */
    suspend fun postJson(
        path: String,
        body: String? = null,
    ): String
}
