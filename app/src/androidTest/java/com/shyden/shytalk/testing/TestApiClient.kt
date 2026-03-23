package com.shyden.shytalk.testing

import com.shyden.shytalk.BuildConfig
import okhttp3.MediaType.Companion.toMediaType
import okhttp3.OkHttpClient
import okhttp3.Request
import okhttp3.RequestBody.Companion.toRequestBody
import org.json.JSONArray
import org.json.JSONObject
import org.junit.rules.TestRule
import org.junit.runner.Description
import org.junit.runners.model.Statement
import java.util.concurrent.TimeUnit

/**
 * JUnit TestRule that manages test data lifecycle via the dev API.
 *
 * Usage:
 * ```
 * @get:Rule val testApi = TestApiClient()
 *
 * @Test fun myTest() {
 *     val data = testApi.setup(users = listOf(TestUser("Alice", "MEMBER")))
 *     // ... run UI test using data.users[0].uid ...
 *     // teardown happens automatically via the TestRule
 * }
 * ```
 */
class TestApiClient : TestRule {
    private val client =
        OkHttpClient
            .Builder()
            .connectTimeout(30, TimeUnit.SECONDS)
            .readTimeout(30, TimeUnit.SECONDS)
            .build()

    private val baseUrl = BuildConfig.API_BASE_URL
    private val testApiKey = "test-api-key-for-ci" // Match TEST_API_KEY in dev .env

    var testRunId: String? = null
        private set

    override fun apply(
        base: Statement,
        description: Description,
    ): Statement =
        object : Statement() {
            override fun evaluate() {
                try {
                    base.evaluate()
                } finally {
                    teardown()
                }
            }
        }

    data class TestUser(
        val name: String,
        val role: String = "MEMBER",
        val coins: Long = 1000,
    )

    data class TestRoom(
        val name: String,
        val ownerId: String? = null,
    )

    data class SetupResult(
        val testRunId: String,
        val users: List<JSONObject>,
        val rooms: List<JSONObject>,
    )

    fun setup(
        users: List<TestUser> = emptyList(),
        rooms: List<TestRoom> = emptyList(),
    ): SetupResult {
        val body =
            JSONObject().apply {
                put(
                    "users",
                    JSONArray(
                        users.map {
                            JSONObject().put("name", it.name).put("role", it.role).put("coins", it.coins)
                        },
                    ),
                )
                put(
                    "rooms",
                    JSONArray(
                        rooms.map {
                            JSONObject().put("name", it.name).apply {
                                if (it.ownerId != null) put("ownerId", it.ownerId)
                            }
                        },
                    ),
                )
            }

        val response = post("/api/test/setup", body)
        testRunId = response.getString("testRunId")

        return SetupResult(
            testRunId = testRunId!!,
            users =
                response.getJSONArray("users").let { arr ->
                    (0 until arr.length()).map { arr.getJSONObject(it) }
                },
            rooms =
                response.getJSONArray("rooms").let { arr ->
                    (0 until arr.length()).map { arr.getJSONObject(it) }
                },
        )
    }

    fun verify(
        collection: String,
        id: String,
    ): JSONObject = get("/api/test/verify/$collection/$id")

    fun teardown() {
        val runId = testRunId ?: return
        try {
            post("/api/test/teardown", JSONObject().put("testRunId", runId))
        } catch (e: Exception) {
            // Log but don't fail — failsafe cron will clean up
            System.err.println("Test teardown failed: ${e.message}")
        }
        testRunId = null
    }

    private fun post(
        path: String,
        body: JSONObject,
    ): JSONObject {
        val request =
            Request
                .Builder()
                .url("$baseUrl$path")
                .post(body.toString().toRequestBody("application/json".toMediaType()))
                .addHeader("X-Test-Api-Key", testApiKey)
                .build()

        val response = client.newCall(request).execute()
        val responseBody = response.body?.string() ?: "{}"
        if (!response.isSuccessful) {
            throw RuntimeException("Test API $path failed: ${response.code} $responseBody")
        }
        return JSONObject(responseBody)
    }

    private fun get(path: String): JSONObject {
        val request =
            Request
                .Builder()
                .url("$baseUrl$path")
                .addHeader("X-Test-Api-Key", testApiKey)
                .build()

        val response = client.newCall(request).execute()
        val responseBody = response.body?.string() ?: "{}"
        if (!response.isSuccessful) {
            throw RuntimeException("Test API $path failed: ${response.code} $responseBody")
        }
        return JSONObject(responseBody)
    }
}
