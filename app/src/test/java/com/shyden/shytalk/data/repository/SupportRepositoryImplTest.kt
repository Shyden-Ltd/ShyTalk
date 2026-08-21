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
