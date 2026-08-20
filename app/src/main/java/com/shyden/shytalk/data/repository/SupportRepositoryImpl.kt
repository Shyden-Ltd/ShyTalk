package com.shyden.shytalk.data.repository

import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.WorkerApiClient
import org.json.JSONObject
import java.io.IOException

/**
 * Android side of SHY-0385 — raise a support ticket via the API.
 *
 * The only interesting line is the 409 mapping. The server refuses a second
 * ticket while one is still open, and that is NOT a failure the person can fix
 * by retrying — it needs its own message. Matching on `statusCode` rather than
 * on the server's English text is what makes that survive a rewording, and what
 * makes it work for somebody reading the app in Thai.
 */
class SupportRepositoryImpl(
    private val api: WorkerApiClient,
) : SupportRepository {
    override suspend fun raiseTicket(
        message: String,
        category: SupportCategory?,
        context: Map<String, String>,
    ): RaiseTicketOutcome =
        try {
            val body = JSONObject().put("message", message)
            category?.let { body.put("category", it.wireValue) }
            if (context.isNotEmpty()) {
                val ctx = JSONObject()
                for ((k, v) in context) ctx.put(k, v)
                body.put("context", ctx)
            }

            val response = api.post(PATH, body)
            RaiseTicketOutcome.Raised(response.optString("ticketId"))
        } catch (e: ApiException) {
            if (e.statusCode == HTTP_CONFLICT) {
                RaiseTicketOutcome.AlreadyOpen
            } else {
                RaiseTicketOutcome.Failed(e.message ?: "Support request failed")
            }
        } catch (e: IOException) {
            RaiseTicketOutcome.Failed(e.message ?: "Support request failed")
        }

    private companion object {
        const val PATH = "/api/support-tickets"
        const val HTTP_CONFLICT = 409
    }
}
