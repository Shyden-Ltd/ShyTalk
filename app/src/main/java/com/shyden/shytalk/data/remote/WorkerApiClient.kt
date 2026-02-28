package com.shyden.shytalk.data.remote

import com.google.firebase.auth.FirebaseAuth
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
 * HTTP client for calling the Cloudflare Worker API.
 * Handles Firebase ID token auth and JSON request/response.
 */
class WorkerApiClient(
    private val httpClient: OkHttpClient,
    private val baseUrl: String,
    private val auth: FirebaseAuth
) {
    private suspend fun getIdToken(): String {
        return auth.currentUser?.getIdToken(false)?.await()?.token
            ?: throw IllegalStateException("Not signed in")
    }

    suspend fun get(path: String): JSONObject {
        val token = getIdToken()
        val request = Request.Builder()
            .url("$baseUrl$path")
            .header("Authorization", "Bearer $token")
            .get()
            .build()
        return executeForJson(request)
    }

    suspend fun getArray(path: String): JSONArray {
        val token = getIdToken()
        val request = Request.Builder()
            .url("$baseUrl$path")
            .header("Authorization", "Bearer $token")
            .get()
            .build()
        return executeForJsonArray(request)
    }

    suspend fun post(path: String, body: JSONObject = JSONObject()): JSONObject {
        val token = getIdToken()
        val request = Request.Builder()
            .url("$baseUrl$path")
            .header("Authorization", "Bearer $token")
            .post(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        return executeForJson(request)
    }

    suspend fun patch(path: String, body: JSONObject): JSONObject {
        val token = getIdToken()
        val request = Request.Builder()
            .url("$baseUrl$path")
            .header("Authorization", "Bearer $token")
            .patch(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        return executeForJson(request)
    }

    suspend fun put(path: String, body: JSONObject = JSONObject()): JSONObject {
        val token = getIdToken()
        val request = Request.Builder()
            .url("$baseUrl$path")
            .header("Authorization", "Bearer $token")
            .put(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        return executeForJson(request)
    }

    suspend fun delete(path: String): JSONObject {
        val token = getIdToken()
        val request = Request.Builder()
            .url("$baseUrl$path")
            .header("Authorization", "Bearer $token")
            .delete()
            .build()
        return executeForJson(request)
    }

    suspend fun delete(path: String, body: JSONObject): JSONObject {
        val token = getIdToken()
        val request = Request.Builder()
            .url("$baseUrl$path")
            .header("Authorization", "Bearer $token")
            .delete(body.toString().toRequestBody("application/json".toMediaType()))
            .build()
        return executeForJson(request)
    }

    private suspend fun executeForJson(request: Request): JSONObject {
        val response = httpClient.newCall(request).executeAsync()
        response.use {
            val bodyStr = it.body?.string() ?: "{}"
            if (!it.isSuccessful) {
                val error = try { JSONObject(bodyStr).optString("error", "Request failed") } catch (_: Exception) { "HTTP ${it.code}" }
                throw ApiException(it.code, error)
            }
            return JSONObject(bodyStr)
        }
    }

    private suspend fun executeForJsonArray(request: Request): JSONArray {
        val response = httpClient.newCall(request).executeAsync()
        response.use {
            val bodyStr = it.body?.string() ?: "[]"
            if (!it.isSuccessful) {
                val error = try { JSONObject(bodyStr).optString("error", "Request failed") } catch (_: Exception) { "HTTP ${it.code}" }
                throw ApiException(it.code, error)
            }
            return JSONArray(bodyStr)
        }
    }
}

class ApiException(val statusCode: Int, message: String) : Exception(message)

private suspend fun Call.executeAsync(): Response = suspendCancellableCoroutine { cont ->
    cont.invokeOnCancellation { cancel() }
    enqueue(object : Callback {
        override fun onFailure(call: Call, e: IOException) = cont.resumeWithException(e)
        override fun onResponse(call: Call, response: Response) = cont.resume(response)
    })
}
