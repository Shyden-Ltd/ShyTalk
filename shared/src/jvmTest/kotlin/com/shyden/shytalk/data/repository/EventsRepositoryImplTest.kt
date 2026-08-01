package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.model.EventState
import com.shyden.shytalk.core.model.InviteStatus
import com.shyden.shytalk.core.util.Resource
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * The shared events repository, against REAL captured API responses.
 *
 * The fixtures in `jvmTest/resources/fixtures/events-*.json` are byte-copies of
 * what the Express API actually returned on 2026-08-02, captured by driving the
 * real routes against the real emulator. That matters more than it sounds: a
 * parser tested against a hand-written idea of the response passes while the
 * real shape differs, which is precisely how a client ships "no events" against
 * a server that is answering correctly.
 *
 * The transport is a recorded stand-in — it returns those captured strings and
 * records what was asked for. That is the sanctioned unit-test position: the
 * DATA is real, only the socket is not, and what is under test here is what the
 * JSON MEANS.
 */
class EventsRepositoryImplTest {
    /** Serves canned bodies and records every path and payload it was given. */
    private class RecordingApi(
        private val responses: Map<String, String> = emptyMap(),
        private val failWith: Exception? = null,
    ) : EventsApi {
        val gets = mutableListOf<String>()
        val posts = mutableListOf<Pair<String, String?>>()

        private fun answer(path: String): String {
            failWith?.let { throw it }
            return responses[path] ?: "{}"
        }

        override suspend fun getJson(path: String): String {
            gets += path
            return answer(path)
        }

        override suspend fun postJson(
            path: String,
            body: String?,
        ): String {
            posts += path to body
            return answer(path)
        }
    }

    private fun fixture(name: String): String =
        requireNotNull(javaClass.classLoader.getResourceAsStream("fixtures/$name")) {
            "missing fixture $name"
        }.bufferedReader().readText()

    private fun <T> success(resource: Resource<T>): T {
        assertTrue(resource is Resource.Success, "expected Success but got $resource")
        return resource.data
    }

    // ── reads ────────────────────────────────────────────────────────────

    @Test
    fun `my events splits hosting from performing`() =
        runTest {
            // Merged lists would put a Start-event button in front of a performer
            // who cannot start it, and the refusal would arrive as a 403 after
            // the tap rather than as an absent control.
            val repo =
                EventsRepositoryImpl(
                    RecordingApi(mapOf("/events/mine" to fixture("events-mine.json"))),
                )
            val mine = success(repo.myEvents())
            assertEquals(1, mine.hosting.size)
            assertEquals("Saturday Showcase", mine.hosting.first().title)
            assertTrue(mine.performing.isEmpty())
        }

    @Test
    fun `an event carries the fields the host screen renders`() =
        runTest {
            val repo =
                EventsRepositoryImpl(
                    RecordingApi(mapOf("/events/mine" to fixture("events-mine.json"))),
                )
            val event = success(repo.myEvents()).hosting.first()
            assertEquals("evcap-tariq", event.hostId)
            assertEquals(60, event.durationMin)
            assertEquals(listOf("evcap-selma"), event.roster)
            assertTrue(event.eventId.isNotBlank())
        }

    @Test
    fun `a live event exposes the room to open and who is performing`() =
        runTest {
            // Without the roomId the "join" control has nothing to open; without
            // currentPerformerId the roster panel cannot show who is on stage.
            val repo =
                EventsRepositoryImpl(
                    RecordingApi(mapOf("/events/x" to fixture("events-event.json"))),
                )
            val event = success(repo.event("x"))
            assertEquals(EventState.LIVE, event.state)
            assertNotNull(event.roomId)
            assertEquals("evcap-selma", event.currentPerformerId)
        }

    @Test
    fun `roster answers are read per member`() =
        runTest {
            // The host's roster panel says "waiting" or "accepted" PER PERSON. A
            // single overall state would hide the one member who declined.
            val repo =
                EventsRepositoryImpl(
                    RecordingApi(mapOf("/events/x" to fixture("events-event.json"))),
                )
            val event = success(repo.event("x"))
            assertEquals(InviteStatus.ACCEPTED, event.rosterStates["evcap-selma"])
        }

    @Test
    fun `an invite carries the host NAME so the banner needs one call`() =
        runTest {
            val repo =
                EventsRepositoryImpl(
                    RecordingApi(mapOf("/events/invites" to fixture("events-invites.json"))),
                )
            val invites = success(repo.pendingInvites())
            assertEquals(1, invites.size)
            assertEquals("tariq", invites.first().hostName)
            assertEquals(InviteStatus.PENDING, invites.first().status)
        }

    @Test
    fun `a null roomId on the wire becomes a null roomId in the model`() =
        runTest {
            // The capture has `"roomId": null` because the event has not started.
            // Reading that as the STRING "null" would make the banner offer a
            // link to a room called "null".
            val repo =
                EventsRepositoryImpl(
                    RecordingApi(mapOf("/events/invites" to fixture("events-invites.json"))),
                )
            assertNull(success(repo.pendingInvites()).first().roomId)
        }

    @Test
    fun `the summary keeps each performer's own line`() =
        runTest {
            // The whole reason the feature exists. One total tells the host what
            // the night made and tells each performer nothing.
            val repo =
                EventsRepositoryImpl(
                    RecordingApi(mapOf("/events/x/summary" to fixture("events-summary.json"))),
                )
            val summary = success(repo.summary("x"))
            assertEquals(1, summary.giftCount)
            assertEquals(500L, summary.coinTotal)
            assertEquals("evcap-alice", summary.topContributorId)
            assertEquals(250L, summary.earningsFor("evcap-selma")?.beanTotal)
        }

    @Test
    fun `a viewer who did not perform has no earnings line`() =
        runTest {
            // Distinct from earning ZERO, which is a line reading 0. "You were
            // not on stage" and "you were on stage and earned nothing" are
            // different things to tell someone.
            val repo =
                EventsRepositoryImpl(
                    RecordingApi(mapOf("/events/x/summary" to fixture("events-summary.json"))),
                )
            val summary = success(repo.summary("x"))
            assertNull(summary.earningsFor("evcap-theo"))
            assertNull(summary.earningsFor(null))
        }

    // ── writes ───────────────────────────────────────────────────────────

    @Test
    fun `starting an event returns the room to open`() =
        runTest {
            val repo =
                EventsRepositoryImpl(
                    RecordingApi(mapOf("/events/x/start" to """{"ok":true,"roomId":"x-room"}""")),
                )
            assertEquals("x-room", success(repo.start("x")))
        }

    @Test
    fun `starting without a room in the response is an ERROR, not an empty string`() =
        runTest {
            // An empty roomId would navigate the host into a room that does not
            // exist, and the failure would surface as an unrelated "room not
            // found" three screens later.
            val repo = EventsRepositoryImpl(RecordingApi(mapOf("/events/x/start" to """{"ok":true}""")))
            assertTrue(repo.start("x") is Resource.Error)
        }

    @Test
    fun `promote and demote name the person`() =
        runTest {
            val api = RecordingApi()
            val repo = EventsRepositoryImpl(api)
            repo.promote("e1", "selma")
            repo.demote("e1", "selma")
            assertEquals("/events/e1/promote", api.posts[0].first)
            assertTrue(api.posts[0].second!!.contains("\"uniqueId\":\"selma\""))
            assertEquals("/events/e1/demote", api.posts[1].first)
        }

    @Test
    fun `a title containing a quote does not break the request body`() =
        runTest {
            // `Selma"s night` would otherwise produce malformed JSON and a 400
            // that reads like a server fault.
            val api = RecordingApi()
            EventsRepositoryImpl(api).schedule("Selma\"s night", "2026-01-01T00:00:00Z", 60, emptyList())
            val body = api.posts.first().second!!
            assertTrue(body.contains("""\"s night"""), "quote was not escaped in: $body")
        }

    @Test
    fun `a backslash in a title is escaped too`() =
        runTest {
            val api = RecordingApi()
            EventsRepositoryImpl(api).schedule("a\\b", "2026-01-01T00:00:00Z", 60, emptyList())
            assertTrue(
                api.posts
                    .first()
                    .second!!
                    .contains("""a\\b"""),
            )
        }

    @Test
    fun `the roster is sent as a JSON array of ids`() =
        runTest {
            val api = RecordingApi()
            EventsRepositoryImpl(api).schedule("Night", "2026-01-01T00:00:00Z", 60, listOf("a", "b"))
            assertTrue(
                api.posts
                    .first()
                    .second!!
                    .contains("""["a","b"]"""),
            )
        }

    @Test
    fun `closing returns the frozen summary`() =
        runTest {
            val repo =
                EventsRepositoryImpl(
                    RecordingApi(
                        mapOf(
                            "/events/x/close" to
                                """{"ok":true,"summary":{"eventId":"x","giftCount":2,"coinTotal":510,"beanTotal":255,"perPerformer":[]}}""",
                        ),
                    ),
                )
            assertEquals(510L, success(repo.close("x")).coinTotal)
        }

    @Test
    fun `closing an event with no summary still succeeds`() =
        runTest {
            // A second close returns `summary: null` because the first one froze
            // it. Treating that as a failure would put an error in front of a
            // host whose event closed perfectly well.
            val repo = EventsRepositoryImpl(RecordingApi(mapOf("/events/x/close" to """{"ok":true}""")))
            assertEquals("x", success(repo.close("x")).eventId)
        }

    // ── failure ──────────────────────────────────────────────────────────

    @Test
    fun `a transport failure is an Error, never an empty list`() =
        runTest {
            // "No events" and "the network is down" must not look the same: one
            // is a screen saying "nothing scheduled", the other needs a retry.
            val repo = EventsRepositoryImpl(RecordingApi(failWith = RuntimeException("offline")))
            val result = repo.myEvents()
            assertTrue(result is Resource.Error)
            assertTrue(result.message.contains("offline"))
        }

    @Test
    fun `malformed JSON is an Error rather than a crash`() =
        runTest {
            val repo = EventsRepositoryImpl(RecordingApi(mapOf("/events/mine" to "not json at all")))
            assertTrue(repo.myEvents() is Resource.Error)
        }

    @Test
    fun `an empty response yields empty lists, not an error`() =
        runTest {
            // A user with nothing scheduled is a normal state, not a fault.
            val repo = EventsRepositoryImpl(RecordingApi(mapOf("/events/mine" to "{}")))
            val mine = success(repo.myEvents())
            assertTrue(mine.hosting.isEmpty())
            assertTrue(mine.performing.isEmpty())
        }

    @Test
    fun `an unknown state on the wire does not crash an installed app`() =
        runTest {
            // A server that grows a fourth state should not take the app with it.
            val repo =
                EventsRepositoryImpl(
                    RecordingApi(
                        mapOf("/events/x" to """{"event":{"eventId":"x","state":"PAUSED_FOR_RAIN"}}"""),
                    ),
                )
            assertEquals(EventState.SCHEDULED, success(repo.event("x")).state)
        }

    @Test
    fun `every read goes through the API — no direct backend`() =
        runTest {
            // The rule this feature was built under. If a read ever stopped
            // going through EventsApi, this recorder would simply see nothing.
            val api = RecordingApi(mapOf("/events/mine" to fixture("events-mine.json")))
            EventsRepositoryImpl(api).myEvents()
            assertEquals(listOf("/events/mine"), api.gets)
            assertFalse(api.gets.isEmpty())
        }
}
