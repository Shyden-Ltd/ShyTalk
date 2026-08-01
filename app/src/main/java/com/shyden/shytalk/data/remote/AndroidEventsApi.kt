package com.shyden.shytalk.data.remote

import com.shyden.shytalk.data.repository.EventsApi
import org.json.JSONObject

/**
 * Android's transport for the events feature.
 *
 * Deliberately trivial. Every decision about what the JSON MEANS lives in the
 * shared `EventsRepositoryImpl`; this only carries bytes, so the two phones
 * cannot drift the way the older repository families did — those are written
 * twice because `WorkerApiClient` returns `org.json.JSONObject` and
 * `IosApiClient` returns `kotlinx.serialization.json.JsonObject`, and the
 * difference leaks all the way up into duplicated business logic.
 *
 * Errors PROPAGATE. Returning an empty body on failure would be
 * indistinguishable from a legitimately empty response, and the repository would
 * report "no events" for "the network is down".
 */
class AndroidEventsApi(
    private val api: WorkerApiClient,
) : EventsApi {
    override suspend fun getJson(path: String): String = api.get(path).toString()

    override suspend fun postJson(
        path: String,
        body: String?,
    ): String = api.post(path, body?.let { JSONObject(it) } ?: JSONObject()).toString()
}
