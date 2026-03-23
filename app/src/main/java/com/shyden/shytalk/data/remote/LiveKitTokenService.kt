package com.shyden.shytalk.data.remote

import org.json.JSONObject

class LiveKitTokenService(
    private val api: WorkerApiClient,
) : TokenService {
    override suspend fun fetchToken(
        roomName: String,
        identity: String,
    ): String {
        val response =
            api.post(
                "/api/livekit/token",
                JSONObject().apply {
                    put("roomName", roomName)
                    put("identity", identity)
                },
            )
        return response
            .optString("token")
            .takeIf { it.isNotEmpty() }
            ?: throw IllegalStateException("Invalid token response from server")
    }
}
