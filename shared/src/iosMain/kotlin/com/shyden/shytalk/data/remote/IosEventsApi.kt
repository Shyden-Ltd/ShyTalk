package com.shyden.shytalk.data.remote

import com.shyden.shytalk.data.repository.EventsApi
import kotlinx.serialization.json.Json
import kotlinx.serialization.json.JsonObject
import kotlinx.serialization.json.jsonObject

/**
 * iOS's transport for the events feature — the mirror of [AndroidEventsApi].
 *
 * Both are a handful of lines because that is the whole point: the platforms
 * differ only in which JSON type their API client speaks, and every decision
 * above that line is made once, in the shared `EventsRepositoryImpl`. The older
 * repository families put the business logic on THIS side of the boundary and
 * consequently exist in two versions that have drifted.
 *
 * Errors propagate rather than becoming an empty body: an empty string is
 * indistinguishable from a legitimately empty response.
 */
class IosEventsApi(
    private val api: IosApiClient,
) : EventsApi {
    private val json = Json

    override suspend fun getJson(path: String): String = api.get(path).toString()

    override suspend fun postJson(
        path: String,
        body: String?,
    ): String {
        val payload: JsonObject? = body?.let { json.parseToJsonElement(it).jsonObject }
        return api.post(path, payload).toString()
    }
}
