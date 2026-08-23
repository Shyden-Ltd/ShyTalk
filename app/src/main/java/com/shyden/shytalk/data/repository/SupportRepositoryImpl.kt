package com.shyden.shytalk.data.repository

import android.util.Log
import com.shyden.shytalk.BuildConfig
import com.shyden.shytalk.data.remote.ApiException
import com.shyden.shytalk.data.remote.WorkerApiClient
import com.shyden.shytalk.data.remote.executeAsync
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import kotlin.coroutines.cancellation.CancellationException

/**
 * Android side of SHY-0385 — raise a support ticket via the API.
 *
 * SHY-0396 removed the 409 mapping that used to live here. The server no longer
 * refuses a second request, because refusing one meant a genuinely DIFFERENT
 * problem reached nobody. What the form does instead is ask first, using
 * [openTickets], and offer [addToTicket] as the answer to "it is the problem I
 * already reported".
 */
class SupportRepositoryImpl(
    private val api: WorkerApiClient,
    private val httpClient: OkHttpClient,
) : SupportRepository {
    override suspend fun raiseTicket(
        message: String,
        category: SupportCategory?,
        context: Map<String, String>,
        attachments: List<String>,
    ): RaiseTicketOutcome =
        try {
            val body = JSONObject().put("message", message)
            category?.let { body.put("category", it.wireValue) }
            // The entry point knows WHY somebody is here; the platform knows WHAT
            // they are running. Both are in the server's allowlist and both are the
            // first thing an admin asks, so the repository fills in its own half
            // rather than trusting three call sites to remember.
            val enriched =
                context +
                    mapOf(
                        "platform" to "android",
                        "appVersion" to BuildConfig.VERSION_NAME,
                    )
            val ctx = JSONObject()
            for ((k, v) in enriched) ctx.put(k, v)
            body.put("context", ctx)
            // Absent rather than empty, so every optional in this payload behaves
            // the same way on the wire.
            if (attachments.isNotEmpty()) {
                body.put("attachments", JSONArray(attachments))
            }

            val response = api.post(PATH, body)
            // `optString` answers "" for an absent key, so this used to report a
            // raised ticket with an empty id. A 200 carrying no id is what a
            // captive portal looks like -- the Wi-Fi login page answers the
            // request and the server never sees it. Failing keeps the person's
            // text on screen; if the ticket really was created, the next visit
            // finds it via `openTickets` and offers to add to it.
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
            RaiseTicketOutcome.Failed(e.message ?: "Support request failed")
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

    /**
     * SHY-0434 — a removed attachment must leave the object store.
     *
     * Best-effort by contract: `false` tells the caller it is still there, and
     * the caller still takes it off the form. Refusing to let go of a file
     * somebody has decided against would leave them unable to send at all.
     */
    override suspend fun deleteAttachment(r2Key: String): Boolean =
        try {
            api.delete(DELETE_ATTACHMENT_PATH, JSONObject().put("r2Key", r2Key))
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Attachment delete failed for $r2Key", e)
            false
        }

    /**
     * SHY-0396 — what this person still has open, for the duplicate warning.
     *
     * Null on ANY failure, and deliberately not an empty list: the caller has to
     * be able to tell "you have nothing open" from "we could not find out", and
     * only one of those is worth logging.
     */
    override suspend fun openTickets(): OpenTicketsView? =
        try {
            val resp = api.get(OPEN_TICKETS_PATH)
            val array = resp.optJSONArray("tickets") ?: JSONArray()
            // Absent rather than guessed: the server omits the count when it
            // could not determine one, and falling back to the list length is
            // the very defect SHY-0424 is about.
            val count = if (resp.has("openCount") && !resp.isNull("openCount")) resp.optInt("openCount") else null
            val summaries =
                (0 until array.length()).mapNotNull { i ->
                    val obj = array.optJSONObject(i) ?: return@mapNotNull null
                    val id = obj.optString("ticketId")
                    // A row with no id is a row nothing can be added to, so it is
                    // dropped rather than offered as an unusable choice.
                    if (id.isBlank()) {
                        null
                    } else {
                        OpenTicketSummary(
                            ticketId = id,
                            category = SupportCategory.fromWire(obj.optString("category")),
                            summary = obj.optString("summary"),
                        )
                    }
                }
            OpenTicketsView(summaries = summaries, openCount = count)
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Could not list open support tickets", e)
            null
        }

    override suspend fun addToTicket(
        ticketId: String,
        message: String,
    ): Boolean =
        try {
            api.post("$PATH/$ticketId/messages", JSONObject().put("message", message))
            true
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // False rather than a throw: the caller keeps the person's text on
            // screen and lets them try again, which is the only useful response.
            Log.w(TAG, "Could not add to support ticket $ticketId", e)
            false
        }

    override suspend fun requestAttachmentUpload(contentType: AttachmentType): UploadHandle? =
        try {
            val resp = api.post(UPLOAD_URL_PATH, JSONObject().put("contentType", contentType.wireValue))
            UploadHandle(
                uploadUrl = resp.getString("uploadUrl"),
                r2Key = resp.getString("r2Key"),
                expiresInSec = resp.optInt("expiresInSec", 300),
            )
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            // Null rather than a handle of empty strings: the caller turns this
            // into what the person sees, and an empty URL would cost them a
            // pointless round trip before saying the same thing.
            Log.w(TAG, "Support attachment upload URL refused", e)
            null
        }

    override suspend fun uploadAttachment(
        uploadUrl: String,
        contentType: AttachmentType,
        bytes: ByteArray,
    ): Boolean =
        try {
            // The signed URL IS the auth -- no Bearer header. The Content-Type
            // must match the one the URL was signed for or R2 rejects it.
            val response =
                httpClient
                    .newCall(
                        Request
                            .Builder()
                            .url(uploadUrl)
                            .put(bytes.toRequestBody(contentType.wireValue.toMediaType()))
                            .build(),
                    ).executeAsync()
            response.use { it.isSuccessful }
        } catch (e: CancellationException) {
            throw e
        } catch (e: Exception) {
            Log.w(TAG, "Support attachment upload failed", e)
            false
        }

    private companion object {
        const val TAG = "SupportRepository"
        const val PATH = "/api/support-tickets"
        const val UPLOAD_URL_PATH = "/api/support-tickets/upload-url"
        const val OPEN_TICKETS_PATH = "/api/support-tickets/mine/open"
        const val DELETE_ATTACHMENT_PATH = "/api/support-tickets/attachments"
    }
}
