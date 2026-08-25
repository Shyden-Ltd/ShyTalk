package com.shyden.shytalk.data.repository

import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.coEvery
import io.mockk.mockk
import io.mockk.slot
import kotlinx.coroutines.test.runTest
import okhttp3.OkHttpClient
import org.json.JSONException
import org.json.JSONObject
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

/**
 * SHY-0385 — the Android side of raising a support ticket.
 *
 * The 409 mapping used to be the whole point of these tests. SHY-0396 removed
 * it: the operator's correction on 2026-08-21 was that a second request must
 * never be refused, because somebody with an open ticket may have a completely
 * different problem and refusing them means the new problem reaches nobody.
 *
 * What replaces it is `openTickets` — how the form finds out there is something
 * to warn about — and `addToTicket`, which is where the words go when the answer
 * is "it is the problem I already reported". The tests below cover both, and pin
 * that a conflict is now nothing special.
 */
class SupportRepositoryImplTest {
    private val api = mockk<WorkerApiClient>()
    private val httpClient = OkHttpClient()
    private val repo = SupportRepositoryImpl(api, httpClient)

    @Test
    fun `a raised ticket returns its id`() =
        runTest {
            coEvery { api.post(any(), any()) } returns JSONObject().put("ticketId", "t-1")

            val outcome = repo.raiseTicket("help", null, emptyMap())

            assertTrue(outcome is RaiseTicketOutcome.Raised)
            assertEquals("t-1", (outcome as RaiseTicketOutcome.Raised).ticketId)
        }

    /**
     * The inversion, kept as a test rather than deleted.
     *
     * A conflict is now an ordinary failure — the person's words stay on screen
     * and they can retry. Nothing may special-case it back into a refusal.
     */
    @Test
    fun `a conflict is now an ordinary failure, not a refusal`() =
        runTest {
            coEvery { api.post(any(), any()) } throws ApiException(409, "conflict")

            val outcome = repo.raiseTicket("help", null, emptyMap())

            assertTrue(
                "SHY-0396: a 409 must not be mapped back into a refusal to raise",
                outcome is RaiseTicketOutcome.Failed,
            )
        }

    // ─── SHY-0396: finding out what is open, and adding to it ───

    @Test
    fun `open tickets come back with the words that make them recognisable`() =
        runTest {
            coEvery { api.get("/api/support-tickets/mine/open") } returns
                JSONObject(
                    """{"tickets":[{"ticketId":"t-9","category":"payment","summary":"Charged twice"}]}""",
                )

            val open = repo.openTickets()

            assertEquals(1, open?.summaries?.size)
            assertEquals("t-9", open?.summaries?.get(0)?.ticketId)
            assertEquals(SupportCategory.Payment, open?.summaries?.get(0)?.category)
            assertEquals("Charged twice", open?.summaries?.get(0)?.summary)
        }

    /**
     * The COUNT the server reports, which is NOT how many summaries came back
     * (SHY-0424). The list is capped for readability; deriving "you have N
     * open" from its length told somebody with eight that they had five.
     */
    @Test
    fun `the open COUNT is read from the server, not from the list length`() =
        runTest {
            coEvery { api.get("/api/support-tickets/mine/open") } returns
                JSONObject(
                    """{"tickets":[{"ticketId":"t-1","category":"other","summary":"a"}],"openCount":8}""",
                )

            val open = repo.openTickets()

            assertEquals(8, open?.openCount)
            assertEquals(1, open?.summaries?.size)
        }

    /**
     * Absent, never guessed. The server omits the count when it could not
     * determine one, and falling back to the list length is the defect itself.
     */
    @Test
    fun `a missing count is null rather than the number of rows`() =
        runTest {
            coEvery { api.get("/api/support-tickets/mine/open") } returns
                JSONObject("""{"tickets":[{"ticketId":"t-1","category":"other","summary":"a"}]}""")

            assertNull(repo.openTickets()?.openCount)
        }

    /**
     * Null, not empty. The caller has to tell "you have nothing open" from "we
     * could not find out" — only one of those is worth a log line, and neither
     * may cost somebody their ticket.
     */
    @Test
    fun `a failed lookup is null rather than an empty list`() =
        runTest {
            coEvery { api.get(any()) } throws IOException("unreachable")

            assertEquals(null, repo.openTickets())
        }

    @Test
    fun `nothing open is an empty list, not null`() =
        runTest {
            coEvery { api.get(any()) } returns JSONObject("""{"tickets":[]}""")

            // Still a VIEW rather than null: the caller must tell "you have
            // nothing open" from "we could not find out", and only the second
            // is worth a log line.
            assertEquals(emptyList<OpenTicketSummary>(), repo.openTickets()?.summaries)
        }

    /**
     * A category this build does not know still has to be offerable. It arrives
     * from the server, so a newer build's category must not crash the only route
     * somebody has to support.
     */
    @Test
    fun `a category this build does not know falls back rather than failing`() =
        runTest {
            coEvery { api.get(any()) } returns
                JSONObject("""{"tickets":[{"ticketId":"t-1","category":"quantum","summary":"?"}]}""")

            assertEquals(
                SupportCategory.Other,
                repo
                    .openTickets()
                    ?.summaries
                    ?.get(0)
                    ?.category,
            )
        }

    /** A row with no id is a row nothing can be added to, so it is not offered. */
    @Test
    fun `a ticket with no id is dropped rather than offered as an unusable choice`() =
        runTest {
            coEvery { api.get(any()) } returns
                JSONObject("""{"tickets":[{"category":"bug","summary":"no id"},{"ticketId":"t-2","summary":"ok"}]}""")

            val open = repo.openTickets()

            assertEquals(1, open?.summaries?.size)
            assertEquals("t-2", open?.summaries?.get(0)?.ticketId)
        }

    @Test
    fun `adding to a ticket posts the words to that ticket`() =
        runTest {
            val path = slot<String>()
            val body = slot<JSONObject>()
            coEvery { api.post(capture(path), capture(body)) } returns JSONObject().put("success", true)

            assertTrue(repo.addToTicket("t-9", "It happened again"))

            assertEquals("/api/support-tickets/t-9/messages", path.captured)
            assertEquals("It happened again", body.captured.getString("message"))
        }

    @Test
    fun `a failed addition is false, so the person keeps their words and can retry`() =
        runTest {
            coEvery { api.post(any(), any()) } throws IOException("unreachable")

            assertTrue(!repo.addToTicket("t-9", "It happened again"))
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

            assertTrue("a category must never be guessed on the client", !body.captured.has("category"))
        }

    /**
     * Context is now ALWAYS sent, even when the entry point supplies none —
     * `platform` and `appVersion` apply to every ticket and are the first two
     * things an admin asks. They were in the server's allowlist and no client
     * ever sent them, which is the same dead-branch defect as SHY-0400.
     */
    @Test
    fun `context always carries the platform and app version, even with no entry-point context`() =
        runTest {
            val body = slot<JSONObject>()
            coEvery { api.post(any(), capture(body)) } returns JSONObject().put("ticketId", "t-6")

            repo.raiseTicket("help", null, emptyMap())

            val ctx = body.captured.getJSONObject("context")
            assertEquals("android", ctx.getString("platform"))
            assertTrue("appVersion must not be blank", ctx.getString("appVersion").isNotBlank())
        }

    @Test
    fun `the entry point's context is preserved alongside the platform fields`() =
        runTest {
            val body = slot<JSONObject>()
            coEvery { api.post(any(), capture(body)) } returns JSONObject().put("ticketId", "t-7")

            repo.raiseTicket("help", null, mapOf("feature" to "lucky_spin", "reason" to "age_restriction"))

            val ctx = body.captured.getJSONObject("context")
            assertEquals("lucky_spin", ctx.getString("feature"))
            assertEquals("age_restriction", ctx.getString("reason"))
            assertEquals("android", ctx.getString("platform"))
        }

    // ─── SHY-0387: attachments ──────────────────────────────────

    @Test
    fun `attachment keys are sent with the ticket`() =
        runTest {
            val body = slot<JSONObject>()
            coEvery { api.post(any(), capture(body)) } returns JSONObject().put("ticketId", "t-4")

            repo.raiseTicket(
                "look at this",
                null,
                emptyMap(),
                listOf("support-tickets/1/a.png", "support-tickets/1/b.mp4"),
            )

            val sent = body.captured.getJSONArray("attachments")
            assertEquals(2, sent.length())
            assertEquals("support-tickets/1/a.png", sent.getString(0))
        }

    /**
     * An empty list must not become an empty `attachments` field on the wire —
     * the server would accept it, but every other absent-optional in this payload
     * is absent rather than empty, and one field behaving differently is how a
     * contract drifts.
     */
    @Test
    fun `no attachments means no attachments field`() =
        runTest {
            val body = slot<JSONObject>()
            coEvery { api.post(any(), capture(body)) } returns JSONObject().put("ticketId", "t-5")

            repo.raiseTicket("nothing to show", null, emptyMap(), emptyList())

            assertTrue(!body.captured.has("attachments"))
        }

    @Test
    fun `an upload handle is read from the server response`() =
        runTest {
            coEvery { api.post("/api/support-tickets/upload-url", any()) } returns
                JSONObject()
                    .put("uploadUrl", "https://r2.example/put")
                    .put("r2Key", "support-tickets/1/a.png")
                    .put("expiresInSec", 300)

            val handle = repo.requestAttachmentUpload(AttachmentType.Png)

            assertEquals("https://r2.example/put", handle?.uploadUrl)
            assertEquals("support-tickets/1/a.png", handle?.r2Key)
        }

    @Test
    fun `the content type is sent so the signature matches the upload`() =
        runTest {
            val body = slot<JSONObject>()
            coEvery { api.post("/api/support-tickets/upload-url", capture(body)) } returns
                JSONObject().put("uploadUrl", "u").put("r2Key", "k")

            repo.requestAttachmentUpload(AttachmentType.Mp4)

            assertEquals("video/mp4", body.captured.getString("contentType"))
        }

    /**
     * A refused upload URL must be `null`, not a handle with empty strings — the
     * ViewModel decides what the person sees from this, and an empty URL would
     * be reported as an upload failure after a pointless network round trip.
     */
    @Test
    fun `a refused upload URL is null, not an empty handle`() =
        runTest {
            coEvery { api.post("/api/support-tickets/upload-url", any()) } throws
                ApiException(400, "contentType must be one of: image/jpeg, ...")

            assertEquals(null, repo.requestAttachmentUpload(AttachmentType.Png))
        }

    @Test
    fun `a network failure requesting an upload URL is null, not a crash`() =
        runTest {
            coEvery { api.post("/api/support-tickets/upload-url", any()) } throws IOException("offline")

            assertEquals(null, repo.requestAttachmentUpload(AttachmentType.Png))
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
