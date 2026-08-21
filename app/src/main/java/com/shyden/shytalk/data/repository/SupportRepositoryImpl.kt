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
 * The only interesting line is the 409 mapping. The server refuses a second
 * ticket while one is still open, and that is NOT a failure the person can fix
 * by retrying — it needs its own message. Matching on `statusCode` rather than
 * on the server's English text is what makes that survive a rewording, and what
 * makes it work for somebody reading the app in Thai.
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
        const val HTTP_CONFLICT = 409
    }
}
