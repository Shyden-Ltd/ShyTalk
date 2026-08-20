package com.shyden.shytalk.data.repository

import android.util.Log
import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.WorkerApiClient
import org.json.JSONObject
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

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
            // `optString` answers "" for an absent key, so this used to report a
            // raised ticket with an empty id. A 200 carrying no id is what a
            // captive portal looks like -- the Wi-Fi login page answers the
            // request and the server never sees it. Failing keeps the person's
            // text on screen; if the ticket really was created, their retry meets
            // the 409 and they are told they already have one open.
            val ticketId = response.optString("ticketId")
            if (ticketId.isBlank()) {
                Log.w(TAG, "Support ticket: a 2xx response carried no ticketId")
                RaiseTicketOutcome.Failed("Support request did not come back with a ticket")
            } else {
                RaiseTicketOutcome.Raised(ticketId)
            }
        } catch (e: CancellationException) {
            // Control flow, not a failure. It must be rethrown ABOVE the broad
            // catch below, or dismissing the dialog mid-send reads as an error.
            throw e
        } catch (e: ApiException) {
            if (e.statusCode == HTTP_CONFLICT) {
                RaiseTicketOutcome.AlreadyOpen
            } else {
                RaiseTicketOutcome.Failed(e.message ?: "Support request failed")
            }
        } catch (e: IOException) {
            RaiseTicketOutcome.Failed(e.message ?: "Support request failed")
        } catch (e: Exception) {
            // `WorkerApiClient` guards its error-path parse but returns
            // `JSONObject(bodyStr)` unguarded on 2xx, so a non-JSON success body
            // throws JSONException -- neither ApiException nor IOException. It
            // escaped both catches, left viewModelScope.launch, and crashed the
            // app. Logged with the throwable, because the stack is the only thing
            // that tells you which of these it was.
            Log.w(TAG, "Support ticket failed unexpectedly", e)
            RaiseTicketOutcome.Failed(e.message ?: "Support request failed")
        }

    private companion object {
        const val TAG = "SupportRepository"
        const val PATH = "/api/support-tickets"
        const val HTTP_CONFLICT = 409
    }
}
