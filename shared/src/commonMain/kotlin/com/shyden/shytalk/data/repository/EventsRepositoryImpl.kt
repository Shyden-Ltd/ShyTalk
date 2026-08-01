package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.EventInvite
import com.shyden.shytalk.core.model.EventState
import com.shyden.shytalk.core.model.EventSummary
import com.shyden.shytalk.core.model.InviteStatus
import com.shyden.shytalk.core.model.PerformerEarnings
import com.shyden.shytalk.core.model.ScheduledEvent
import com.shyden.shytalk.core.util.Resource
import kotlinx.coroutines.CancellationException
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.JsonPrimitive
import kotlinx.serialization.json.contentOrNull
import kotlinx.serialization.json.intOrNull
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.longOrNull

/**
 * The one events implementation, shared by both phones.
 *
 * Everything below the transport is decided here exactly once: what the JSON
 * means, what a missing field falls back to, what counts as an error. The two
 * existing repository families each write that twice and have drifted; this is
 * the shape that cannot.
 *
 * PARSING IS TOLERANT ON READ, STRICT ON MEANING. A field the server has not
 * sent yet becomes a sensible default rather than an exception — an installed
 * app should survive the API growing a field. But a field that is PRESENT and
 * wrong is never guessed at: an unparseable number stays 0 rather than becoming
 * "probably what they meant".
 */
class EventsRepositoryImpl(
    private val api: EventsApi,
) : EventsRepository {
    private val json = Json { ignoreUnknownKeys = true }

    // ── parsing ──────────────────────────────────────────────────────────

    private fun JsonObject.str(key: String): String = (this[key] as? JsonPrimitive)?.contentOrNull.orEmpty()

    private fun JsonObject.strOrNull(key: String): String? =
        (this[key] as? JsonPrimitive)?.contentOrNull?.takeIf { it.isNotBlank() && it != "null" }

    private fun JsonObject.long(key: String): Long = (this[key] as? JsonPrimitive)?.longOrNull ?: 0L

    private fun JsonObject.int(
        key: String,
        default: Int = 0,
    ): Int = (this[key] as? JsonPrimitive)?.intOrNull ?: default

    private fun JsonObject.strings(key: String): List<String> =
        (this[key] as? JsonArray)?.mapNotNull { (it as? JsonPrimitive)?.contentOrNull }.orEmpty()

    private fun parseEvent(o: JsonObject): ScheduledEvent =
        ScheduledEvent(
            eventId = o.str("eventId"),
            title = o.str("title"),
            hostId = o.str("hostId"),
            startsAt = o.str("startsAt"),
            durationMin = o.int("durationMin", default = 60),
            state = EventState.fromWire(o.strOrNull("state")),
            roster = o.strings("roster"),
            roomId = o.strOrNull("roomId"),
            currentPerformerId = o.strOrNull("currentPerformerId"),
            // The API sends this as an ARRAY of {uniqueId, status} — not a map.
            // A first version of this parser assumed a map and silently produced
            // an EMPTY roster panel; the captured real response is what caught
            // it, which is the whole reason the fixtures are real captures.
            rosterStates =
                (o["rosterStates"] as? JsonArray)
                    ?.mapNotNull { it as? JsonObject }
                    ?.associate { it.str("uniqueId") to InviteStatus.fromWire(it.strOrNull("status")) }
                    .orEmpty(),
        )

    private fun parseInvite(o: JsonObject): EventInvite =
        EventInvite(
            eventId = o.str("eventId"),
            title = o.str("title"),
            hostId = o.str("hostId"),
            hostName = o.strOrNull("hostName") ?: o.str("hostId"),
            startsAt = o.str("startsAt"),
            status = InviteStatus.fromWire(o.strOrNull("status")),
            state = EventState.fromWire(o.strOrNull("state")),
            roomId = o.strOrNull("roomId"),
        )

    private fun parseSummary(o: JsonObject): EventSummary =
        EventSummary(
            eventId = o.str("eventId"),
            giftCount = o.int("giftCount"),
            coinTotal = o.long("coinTotal"),
            beanTotal = o.long("beanTotal"),
            topContributorId = o.strOrNull("topContributorId"),
            topContributorCoins = o.long("topContributorCoins"),
            perPerformer =
                (o["perPerformer"] as? JsonArray)
                    ?.mapNotNull { it as? JsonObject }
                    ?.map { p ->
                        PerformerEarnings(
                            uniqueId = p.str("uniqueId"),
                            giftCount = p.int("giftCount"),
                            coinTotal = p.long("coinTotal"),
                            beanTotal = p.long("beanTotal"),
                        )
                    }.orEmpty(),
        )

    private fun body(raw: String): JsonObject = json.parseToJsonElement(raw).jsonObject

    /**
     * Run a call, turning any failure into a message the UI can show.
     *
     * CancellationException is rethrown, never swallowed: a cancelled coroutine
     * that reports "something went wrong" puts an error banner on a screen the
     * user has already left.
     */
    private inline fun <T> guarded(block: () -> T): Resource<T> =
        try {
            Resource.Success(block())
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Resource.Error(e.message ?: "Could not reach the events service", e)
        }

    // ── reads ────────────────────────────────────────────────────────────

    override suspend fun myEvents(): Resource<EventsRepository.MyEvents> =
        guarded {
            val o = body(api.getJson("/events/mine"))
            val list = { key: String ->
                (o[key] as? JsonArray)?.mapNotNull { it as? JsonObject }?.map(::parseEvent).orEmpty()
            }
            EventsRepository.MyEvents(hosting = list("hosting"), performing = list("performing"))
        }

    override suspend fun pendingInvites(): Resource<List<EventInvite>> =
        guarded {
            body(api.getJson("/events/invites"))["invites"]
                ?.jsonArray
                ?.mapNotNull { it as? JsonObject }
                ?.map(::parseInvite)
                .orEmpty()
        }

    override suspend fun event(eventId: String): Resource<ScheduledEvent> =
        guarded { parseEvent(body(api.getJson("/events/$eventId"))["event"]!!.jsonObject) }

    override suspend fun summary(eventId: String): Resource<EventSummary> =
        guarded { parseSummary(body(api.getJson("/events/$eventId/summary"))["summary"]!!.jsonObject) }

    // ── writes ───────────────────────────────────────────────────────────

    override suspend fun schedule(
        title: String,
        startsAtIso: String,
        durationMin: Int,
        roster: List<String>,
    ): Resource<ScheduledEvent> =
        guarded {
            val payload =
                buildString {
                    append("{\"title\":").append(quote(title))
                    append(",\"startsAt\":").append(quote(startsAtIso))
                    append(",\"durationMin\":").append(durationMin)
                    append(",\"roster\":[")
                    append(roster.joinToString(",") { quote(it) })
                    append("]}")
                }
            parseEvent(body(api.postJson("/events", payload))["event"]!!.jsonObject)
        }

    override suspend fun acceptInvite(eventId: String): Resource<Unit> =
        guarded {
            api.postJson("/events/$eventId/invite/accept").discard()
        }

    override suspend fun declineInvite(eventId: String): Resource<Unit> =
        guarded {
            api.postJson("/events/$eventId/invite/decline").discard()
        }

    override suspend fun start(eventId: String): Resource<String> =
        guarded {
            val o = body(api.postJson("/events/$eventId/start"))
            // The roomId is the whole point of starting; an empty one would send
            // the host to a room that does not exist, so it fails loudly here.
            o.strOrNull("roomId") ?: error("The event started but the API returned no room to open")
        }

    override suspend fun promote(
        eventId: String,
        uniqueId: String,
    ): Resource<Unit> =
        guarded {
            api.postJson("/events/$eventId/promote", "{\"uniqueId\":${quote(uniqueId)}}").discard()
        }

    override suspend fun demote(
        eventId: String,
        uniqueId: String,
    ): Resource<Unit> =
        guarded {
            api.postJson("/events/$eventId/demote", "{\"uniqueId\":${quote(uniqueId)}}").discard()
        }

    override suspend fun close(eventId: String): Resource<EventSummary> =
        guarded {
            val o = body(api.postJson("/events/$eventId/close"))
            (o["summary"] as? JsonObject)?.let(::parseSummary) ?: EventSummary(eventId = eventId)
        }

    override suspend fun addToRoster(uniqueId: String): Resource<Unit> =
        guarded {
            api.postJson("/events/roster/add", "{\"uniqueId\":${quote(uniqueId)}}").discard()
        }

    override suspend fun removeFromRoster(uniqueId: String): Resource<Unit> =
        guarded {
            api.postJson("/events/roster/remove", "{\"uniqueId\":${quote(uniqueId)}}").discard()
        }

    /** Consume a response body that a write does not need. */
    private fun String.discard() = Unit

    private companion object {
        /**
         * JSON-quote a value.
         *
         * Hand-rolled rather than serialized from a data class because the
         * bodies are three fields wide and adding @Serializable models for them
         * would be more code than this. Escaping is NOT optional though: an
         * event titled `Selma"s night` would otherwise produce malformed JSON
         * and a 400 that looked like a server fault.
         */
        fun quote(value: String): String =
            buildString {
                append('"')
                for (c in value) {
                    when {
                        c == '"' -> append("\\\"")

                        c == '\\' -> append("\\\\")

                        c == '\n' -> append("\\n")

                        c == '\r' -> append("\\r")

                        c == '\t' -> append("\\t")

                        // Any other control character has no literal form in
                        // JSON and must be escaped, or the body is malformed.
                        c < ' ' -> append("\\u").append(c.code.toString(16).padStart(4, '0'))

                        else -> append(c)
                    }
                }
                append('"')
            }
    }
}
