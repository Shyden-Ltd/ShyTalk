package com.shyden.shytalk.data.remote

import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.core.util.logW
import dev.gitlive.firebase.Firebase
import dev.gitlive.firebase.auth.auth
import io.ktor.client.HttpClient
import io.ktor.client.call.body
import io.ktor.client.engine.darwin.Darwin
import io.ktor.client.plugins.contentnegotiation.ContentNegotiation
import io.ktor.client.request.delete
import io.ktor.client.request.forms.MultiPartFormDataContent
import io.ktor.client.request.forms.formData
import io.ktor.client.request.get
import io.ktor.client.request.header
import io.ktor.client.request.patch
import io.ktor.client.request.post
import io.ktor.client.request.put
import io.ktor.client.request.setBody
import io.ktor.client.statement.HttpResponse
import io.ktor.client.statement.bodyAsText
import io.ktor.http.ContentType
import io.ktor.http.Headers
import io.ktor.http.HttpHeaders
import io.ktor.http.contentType
import io.ktor.serialization.kotlinx.json.json
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonArray
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonArray
import kotlinx.serialization.json.jsonObject
import kotlinx.serialization.json.jsonPrimitive

/**
 * iOS HTTP client for the Express API. Mirrors Android's WorkerApiClient.
 *
 * Uses Ktor Darwin engine with Firebase Auth token management.
 * Automatically attaches Bearer token, device ID, and trace headers.
 * Retries once on 401 with a forced token refresh.
 */
class IosApiClient(
    private val baseUrl: String,
    private val deviceId: String,
) {
    companion object {
        private const val TAG = "IosApiClient"
        private const val TOKEN_TTL_MS = 50 * 60 * 1000L // 50 minutes
    }

    private val json =
        Json {
            ignoreUnknownKeys = true
            isLenient = true
        }

    private val client =
        HttpClient(Darwin) {
            install(ContentNegotiation) {
                json(json)
            }
            engine {
                configureRequest {
                    setAllowsCellularAccess(true)
                }
            }
        }

    private var cachedToken: String? = null
    private var tokenTimestamp: Long = 0

    private suspend fun getIdToken(forceRefresh: Boolean = false): String? {
        val now =
            com.shyden.shytalk.core.util
                .currentTimeMillis()
        if (!forceRefresh && cachedToken != null && (now - tokenTimestamp) < TOKEN_TTL_MS) {
            return cachedToken
        }
        return try {
            val token = Firebase.auth.currentUser?.getIdToken(forceRefresh)
            if (token != null) {
                cachedToken = token
                tokenTimestamp = now
            }
            token
        } catch (e: Exception) {
            logW(TAG, "Failed to get ID token: ${e.message}")
            cachedToken
        }
    }

    fun clearTokenCache() {
        cachedToken = null
        tokenTimestamp = 0
    }

    suspend fun get(path: String): JsonObject = request("GET", path)

    /**
     * GET an endpoint that returns a JSON array at the top level (e.g.
     * `/api/reports`). Android's WorkerApiClient has the same `getArray` method.
     * Throws if the response is a JSON object instead of an array — caller
     * should use [get] for object responses.
     */
    suspend fun getArray(path: String): JsonArray {
        val token = getIdToken() ?: throw ApiException(401, "Not authenticated")
        val response = executeRequest("GET", path, null, token)
        val freshResponse =
            if (response.status.value == 401) {
                val freshToken = getIdToken(forceRefresh = true) ?: throw ApiException(401, "Token refresh failed")
                executeRequest("GET", path, null, freshToken)
            } else {
                response
            }
        return parseArrayResponse(freshResponse)
    }

    suspend fun post(
        path: String,
        body: JsonObject? = null,
    ): JsonObject = request("POST", path, body)

    suspend fun patch(
        path: String,
        body: JsonObject? = null,
    ): JsonObject = request("PATCH", path, body)

    suspend fun put(
        path: String,
        body: JsonObject? = null,
    ): JsonObject = request("PUT", path, body)

    suspend fun delete(path: String): JsonObject = request("DELETE", path)

    suspend fun delete(
        path: String,
        body: JsonObject?,
    ): JsonObject = request("DELETE", path, body)

    suspend fun getPublic(path: String): JsonObject {
        val response =
            client.get("$baseUrl$path") {
                header("X-Device-Id", deviceId)
            }
        return parseResponse(response)
    }

    /**
     * Multipart upload — used for image uploads to the storage worker.
     * Mirrors Android `StorageRepositoryImpl.uploadImage` (OkHttp multipart),
     * with the same auth + 401 retry semantics as the JSON endpoints.
     */
    suspend fun postMultipart(
        path: String,
        fileBytes: ByteArray,
        fileName: String,
        fileContentType: String,
        formFields: Map<String, String> = emptyMap(),
    ): JsonObject {
        val token = getIdToken() ?: throw ApiException(401, "Not authenticated")
        val response = executeMultipart(path, fileBytes, fileName, fileContentType, formFields, token)
        if (response.status.value == 401) {
            logI(TAG, "401 on multipart $path — refreshing token and retrying")
            val freshToken = getIdToken(forceRefresh = true) ?: throw ApiException(401, "Token refresh failed")
            return parseResponse(
                executeMultipart(path, fileBytes, fileName, fileContentType, formFields, freshToken),
            )
        }
        return parseResponse(response)
    }

    private suspend fun executeMultipart(
        path: String,
        fileBytes: ByteArray,
        fileName: String,
        fileContentType: String,
        formFields: Map<String, String>,
        token: String,
    ): HttpResponse {
        val multipart =
            MultiPartFormDataContent(
                formData {
                    formFields.forEach { (name, value) -> append(name, value) }
                    append(
                        "file",
                        fileBytes,
                        Headers.build {
                            append(HttpHeaders.ContentType, fileContentType)
                            append(HttpHeaders.ContentDisposition, "filename=\"$fileName\"")
                        },
                    )
                },
            )
        return client.post("$baseUrl$path") {
            header("Authorization", "Bearer $token")
            header("X-Device-Id", deviceId)
            setBody(multipart)
        }
    }

    suspend fun postPublic(
        path: String,
        body: JsonObject? = null,
    ): JsonObject {
        val response =
            client.post("$baseUrl$path") {
                header("X-Device-Id", deviceId)
                if (body != null) {
                    contentType(ContentType.Application.Json)
                    setBody(body.toString())
                }
            }
        return parseResponse(response)
    }

    private suspend fun request(
        method: String,
        path: String,
        body: JsonObject? = null,
        isRetry: Boolean = false,
    ): JsonObject {
        val token = getIdToken() ?: throw ApiException(401, "Not authenticated")
        val response = executeRequest(method, path, body, token)

        if (response.status.value == 401 && !isRetry) {
            logI(TAG, "401 on $method $path — refreshing token and retrying")
            val freshToken = getIdToken(forceRefresh = true) ?: throw ApiException(401, "Token refresh failed")
            val retryResponse = executeRequest(method, path, body, freshToken)
            return parseResponse(retryResponse)
        }

        return parseResponse(response)
    }

    private suspend fun executeRequest(
        method: String,
        path: String,
        body: JsonObject?,
        token: String,
    ): HttpResponse {
        val url = "$baseUrl$path"
        val block: io.ktor.client.request.HttpRequestBuilder.() -> Unit = {
            header("Authorization", "Bearer $token")
            header("X-Device-Id", deviceId)
            if (body != null) {
                contentType(ContentType.Application.Json)
                setBody(body.toString())
            }
        }
        return when (method) {
            "GET" -> client.get(url, block)
            "POST" -> client.post(url, block)
            "PATCH" -> client.patch(url, block)
            "PUT" -> client.put(url, block)
            "DELETE" -> client.delete(url, block)
            else -> throw IllegalArgumentException("Unknown HTTP method: $method")
        }
    }

    private suspend fun parseResponse(response: HttpResponse): JsonObject {
        val status = response.status.value
        val text = response.bodyAsText()

        if (status !in 200..299) {
            val errorMsg =
                try {
                    json
                        .parseToJsonElement(text)
                        .jsonObject["error"]
                        ?.jsonPrimitive
                        ?.content ?: text
                } catch (e: Exception) {
                    text
                }
            logE(TAG, "HTTP $status: $errorMsg")
            throw ApiException(status, errorMsg)
        }

        return try {
            json.parseToJsonElement(text).jsonObject
        } catch (e: Exception) {
            // Response might be empty or non-JSON
            JsonObject(emptyMap())
        }
    }

    private suspend fun parseArrayResponse(response: HttpResponse): JsonArray {
        val status = response.status.value
        val text = response.bodyAsText()

        if (status !in 200..299) {
            val errorMsg =
                try {
                    json
                        .parseToJsonElement(text)
                        .jsonObject["error"]
                        ?.jsonPrimitive
                        ?.content ?: text
                } catch (e: Exception) {
                    text
                }
            logE(TAG, "HTTP $status: $errorMsg")
            throw ApiException(status, errorMsg)
        }

        return try {
            json.parseToJsonElement(text).jsonArray
        } catch (e: Exception) {
            // Empty or non-JSON response — return empty array rather than throw
            // so callers can treat "no data" the same as "empty list".
            JsonArray(emptyList())
        }
    }
}

class ApiException(
    val statusCode: Int,
    override val message: String,
) : Exception(message)
