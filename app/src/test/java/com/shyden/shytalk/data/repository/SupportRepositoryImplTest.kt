package com.shyden.shytalk.data.repository

import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.test.runTest
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException

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
}
