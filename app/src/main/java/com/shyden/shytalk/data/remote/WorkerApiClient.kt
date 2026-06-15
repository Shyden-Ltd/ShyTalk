package com.shyden.shytalk.data.remote

import com.google.firebase.auth.FirebaseAuth
import com.shyden.shytalk.core.util.TraceManager
import kotlinx.coroutines.suspendCancellableCoroutine
import kotlinx.coroutines.tasks.await
import okhttp3.Call
import okhttp3.Callback
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import okhttp3.Response
import org.json.JSONArray
import org.json.JSONObject
import java.io.IOException
import kotlin.coroutines.resume
import kotlin.coroutines.resumeWithException

/**
 * HTTP client for calling the Express API.
 * Handles Firebase ID token auth and JSON request/response.
 */
class WorkerApiClient(
    private val httpClient: OkHttpClient,
    private val baseUrl: String,
    private val auth: FirebaseAuth,
    private val deviceId: String = "",
) {
    @Volatile private var cachedToken: String? = null

    @Volatile private var tokenExpiresAt: Long = 0L

    private suspend fun getIdToken(forceRefresh: Boolean = false): String {
        if (!forceRefresh) {
            val now = System.currentTimeMillis()
            cachedToken?.let { if (now < tokenExpiresAt) return it }
        }
        val token =
            auth.currentUser
                ?.getIdToken(forceRefresh)
                ?.await()
                ?.token
                ?: throw IllegalStateException("Not signed in")
        cachedToken = token
        tokenExpiresAt = System.currentTimeMillis() + 50 * 60 * 1000L
        return token
    }

    fun clearTokenCache() {
        cachedToken = null
        tokenExpiresAt = 0L
    }

    suspend fun get(path: String): JSONObject =
        executeWithRetry(path) { url, token ->
            Request
                .Builder()
                .url(url)
                .header("Authorization", "Bearer $token")
                .get()
                .build()
        }

    /** GET without authentication — for public endpoints like /api/health. */
    suspend fun getPublic(path: String): JSONObject {
        val url = "$baseUrl$path"
        val request =
            Request
                .Builder()
                .url(url)
                .header("x-session-trace-id", TraceManager.sessionTraceId)
                .header("X-Device-Id", deviceId)
                .get()
                .build()
        val response = httpClient.newCall(request).executeAsync()
        val bodyStr = response.use { it.body.string() }
        if (!response.isSuccessful) {
            val error =
                try {
                    JSONObject(bodyStr).optString("error", "Request failed")
                } catch (_: Exception) {
                    "HTTP ${response.code}"
                }
            throw ApiException(response.code, error)
        }
        return JSONObject(bodyStr)
    }

    /** POST without authentication — for public auth endpoints (OTP, PIN verify). */
    suspend fun postPublic(
        path: String,
        body: JSONObject = JSONObject(),
    ): JSONObject {
        val url = "$baseUrl$path"
        val request =
            Request
                .Builder()
                .url(url)
                .header("x-session-trace-id", TraceManager.sessionTraceId)
                .header("X-Device-Id", deviceId)
                .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
                .build()
        val response = httpClient.newCall(request).executeAsync()
        val bodyStr = response.use { it.body.string() }
        if (!response.isSuccessful) {
            val error =
                try {
                    JSONObject(bodyStr).optString("error", "Request failed")
                } catch (_: Exception) {
                    "HTTP ${response.code}"
                }
            throw ApiException(response.code, error)
        }
        return JSONObject(bodyStr)
    }

    suspend fun getArray(path: String): JSONArray =
        executeArrayWithRetry(path) { url, token ->
            Request
                .Builder()
                .url(url)
                .header("Authorization", "Bearer $token")
                .get()
                .build()
        }

    suspend fun post(
        path: String,
        body: JSONObject = JSONObject(),
    ): JSONObject =
        executeWithRetry(path) { url, token ->
            Request
                .Builder()
                .url(url)
                .header("Authorization", "Bearer $token")
                .post(body.toString().toRequestBody(JSON_MEDIA_TYPE))
                .build()
        }

    suspend fun patch(
        path: String,
        body: JSONObject,
    ): JSONObject =
        executeWithRetry(path) { url, token ->
            Request
                .Builder()
                .url(url)
                .header("Authorization", "Bearer $token")
                .patch(body.toString().toRequestBody(JSON_MEDIA_TYPE))
                .build()
        }

    suspend fun put(
        path: String,
        body: JSONObject = JSONObject(),
    ): JSONObject =
        executeWithRetry(path) { url, token ->
            Request
                .Builder()
                .url(url)
                .header("Authorization", "Bearer $token")
                .put(body.toString().toRequestBody(JSON_MEDIA_TYPE))
                .build()
        }

    suspend fun delete(path: String): JSONObject =
        executeWithRetry(path) { url, token ->
            Request
                .Builder()
                .url(url)
                .header("Authorization", "Bearer $token")
                .delete()
                .build()
        }

    suspend fun delete(
        path: String,
        body: JSONObject,
    ): JSONObject =
        executeWithRetry(path) { url, token ->
            Request
                .Builder()
                .url(url)
                .header("Authorization", "Bearer $token")
                .delete(body.toString().toRequestBody(JSON_MEDIA_TYPE))
                .build()
        }

    private suspend fun executeWithRetry(
        path: String,
        buildRequest: (String, String) -> Request,
    ): JSONObject {
        val url = "$baseUrl$path"
        val token = getIdToken()
        val request = buildRequest(url, token).withTraceAndDeviceHeaders(deviceId)
        val response = httpClient.newCall(request).executeAsync()
        val bodyStr = response.use { it.body.string() }
        val code = response.code

        if (code == 401) {
            // Token rejected — force refresh and retry once
            clearTokenCache()
            val freshToken = getIdToken(forceRefresh = true)
            val retryRequest = buildRequest(url, freshToken).withTraceAndDeviceHeaders(deviceId)
            val retryResponse = httpClient.newCall(retryRequest).executeAsync()
            val retryBody = retryResponse.use { it.body.string() }
            if (!retryResponse.isSuccessful) {
                val error =
                    try {
                        JSONObject(retryBody).optString("error", "Request failed")
                    } catch (
                        _: Exception,
                    ) {
                        "HTTP ${retryResponse.code}"
                    }
                throw ApiException(retryResponse.code, error)
            }
            return JSONObject(retryBody)
        }

        if (!response.isSuccessful) {
            val error =
                try {
                    JSONObject(bodyStr).optString("error", "Request failed")
                } catch (_: Exception) {
                    "HTTP $code"
                }
            throw ApiException(code, error)
        }
        return JSONObject(bodyStr)
    }

    private suspend fun executeArrayWithRetry(
        path: String,
        buildRequest: (String, String) -> Request,
    ): JSONArray {
        val url = "$baseUrl$path"
        val token = getIdToken()
        val request = buildRequest(url, token).withTraceAndDeviceHeaders(deviceId)
        val response = httpClient.newCall(request).executeAsync()
        val bodyStr = response.use { it.body.string() }
        val code = response.code

        if (code == 401) {
            clearTokenCache()
            val freshToken = getIdToken(forceRefresh = true)
            val retryRequest = buildRequest(url, freshToken).withTraceAndDeviceHeaders(deviceId)
            val retryResponse = httpClient.newCall(retryRequest).executeAsync()
            val retryBody = retryResponse.use { it.body.string() }
            if (!retryResponse.isSuccessful) {
                val error =
                    try {
                        JSONObject(retryBody).optString("error", "Request failed")
                    } catch (
                        _: Exception,
                    ) {
                        "HTTP ${retryResponse.code}"
                    }
                throw ApiException(retryResponse.code, error)
            }
            return JSONArray(retryBody)
        }

        if (!response.isSuccessful) {
            val error =
                try {
                    JSONObject(bodyStr).optString("error", "Request failed")
                } catch (_: Exception) {
                    "HTTP $code"
                }
            throw ApiException(code, error)
        }
        return JSONArray(bodyStr)
    }

    companion object {
        private val JSON_MEDIA_TYPE = "application/json".toMediaType()
    }
}

private fun Request.withTraceAndDeviceHeaders(deviceId: String): Request =
    newBuilder()
        .header("x-session-trace-id", TraceManager.sessionTraceId)
        .header("X-Device-Id", deviceId)
        .build()

class ApiException(
    val statusCode: Int,
    message: String,
) : Exception(message)

private suspend fun Call.executeAsync(): Response =
    suspendCancellableCoroutine { cont ->
        cont.invokeOnCancellation { cancel() }
        enqueue(
            object : Callback {
                override fun onFailure(
                    call: Call,
                    e: IOException,
                ) = cont.resumeWithException(e)

                override fun onResponse(
                    call: Call,
                    response: Response,
                ) = cont.resume(response)
            },
        )
    }
