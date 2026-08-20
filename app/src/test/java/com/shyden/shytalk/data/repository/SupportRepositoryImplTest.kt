package com.shyden.shytalk.data.repository

import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.test.runTest
import org.json.JSONException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

/**
 * SHY-0385 — the Android side of raising a support ticket.
 *
 * The 409 mapping is the whole point of these tests. "You already have an open
 * request" is not a retryable failure and must not be shown as one, and it has
 * to be recognised by STATUS CODE — recognising it by the server's English
 * message would break on a rewording and never worked for a non-English reader
 * in the first place.
 */
class SupportRepositoryImplTest {
    private val api = mockk<WorkerApiClient>()
    private val repo = SupportRepositoryImpl(api)

    @Test
    fun `a raised ticket returns its id`() =
        runTest {
            coEvery { api.post(any(), any()) } returns JSONObject().put("ticketId", "t-1")

            val outcome = repo.raiseTicket("help", null, emptyMap())

            assertTrue(outcome is RaiseTicketOutcome.Raised)
            assertEquals("t-1", (outcome as RaiseTicketOutcome.Raised).ticketId)
        }

    @Test
    fun `a 409 is an already-open request, not a failure`() =
        runTest {
            coEvery { api.post(any(), any()) } throws ApiException(409, "You already have an open support request")

            val outcome = repo.raiseTicket("help", null, emptyMap())

            assertEquals(RaiseTicketOutcome.AlreadyOpen, outcome)
        }

    @Test
    fun `another status is a plain failure`() =
        runTest {
            coEvery { api.post(any(), any()) } throws ApiException(500, "boom")

            val outcome = repo.raiseTicket("help", null, emptyMap())

            assertTrue(outcome is RaiseTicketOutcome.Failed)
        }

    @Test
    fun `a network error is a plain failure, not a crash`() =
        runTest {
            coEvery { api.post(any(), any()) } throws IOException("unreachable")

            val outcome = repo.raiseTicket("help", null, emptyMap())

            assertTrue(outcome is RaiseTicketOutcome.Failed)
        }

    @Test
    fun `the category and context are sent in the body`() =
        runTest {
            val body = slot<JSONObject>()
            coEvery { api.post(any(), capture(body)) } returns JSONObject().put("ticketId", "t-2")

            repo.raiseTicket("help", SupportCategory.Age, mapOf("feature" to "gacha"))

            assertEquals("age", body.captured.getString("category"))
            assertEquals("gacha", body.captured.getJSONObject("context").getString("feature"))
        }

    @Test
    fun `no category means no category field, rather than a guessed default`() =
        runTest {
            val body = slot<JSONObject>()
            coEvery { api.post(any(), capture(body)) } returns JSONObject().put("ticketId", "t-3")

            repo.raiseTicket("help", null, emptyMap())

            assertTrue(!body.captured.has("category"))
            assertTrue(!body.captured.has("context"))
        }

    // ─── The paths that used to say nothing ─────────────────────

    /**
     * `optString` returns "" for an absent key, so a 2xx carrying no `ticketId`
     * used to be reported as a raised ticket with an empty id — and the log line
     * read "Support ticket raised: ".
     *
     * A 200 with no ticket id is what a captive portal looks like: the Wi-Fi
     * login page answers 200 with HTML, nothing reaches the server, and the
     * person is told their message arrived. Treating it as a failure keeps their
     * text on screen; if the ticket really was created, the retry meets a 409 and
     * they are told they already have one open. Being wrong in that direction
     * costs a sentence. Being wrong in the other direction loses what they wrote.
     */
    @Test
    fun `a success carrying no ticket id is a failure, not a silent success`() =
        runTest {
            coEvery { api.post(any(), any()) } returns JSONObject()

            val outcome = repo.raiseTicket("help", null, emptyMap())

            assertTrue("a 2xx without a ticketId must not read as success", outcome is RaiseTicketOutcome.Failed)
        }

    /**
     * `WorkerApiClient` guards its ERROR-path parse but returns
     * `JSONObject(bodyStr)` unguarded on 2xx, so a non-JSON success body throws
     * `JSONException` — which is neither `ApiException` nor `IOException`. It
     * escaped both catches, left `viewModelScope.launch`, and took the app down.
     */
    @Test
    fun `a non-JSON success body is a failure, not a crash`() =
        runTest {
            coEvery { api.post(any(), any()) } throws JSONException("Value <!DOCTYPE of type java.lang.String")

            val outcome = repo.raiseTicket("help", null, emptyMap())

            assertTrue(outcome is RaiseTicketOutcome.Failed)
        }

    /** A broad catch must never swallow cancellation — it is control flow. */
    @Test
    fun `cancelling the send is not reported as a failure`() =
        runTest {
            coEvery { api.post(any(), any()) } throws CancellationException("dialog dismissed")

            var propagated = false
            try {
                repo.raiseTicket("help", null, emptyMap())
            } catch (e: CancellationException) {
                propagated = true
            }

            assertTrue("cancellation must propagate, not become a Failed outcome", propagated)
        }
}
