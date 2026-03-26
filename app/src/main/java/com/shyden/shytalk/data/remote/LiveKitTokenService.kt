package com.shyden.shytalk.data.remote

import org.json.JSONObject

class LiveKitTokenService(
    private val api: WorkerApiClient,
) : TokenService {
    override suspend fun fetchToken(roomName: String): TokenResponse {
        val response =
            api.post(
                "/api/livekit/token",
                JSONObject().apply {
                    put("roomName", roomName)
                },
            )
        val token =
            response
                .optString("token")
                .takeIf { it.isNotEmpty() }
                ?: throw IllegalStateException("Invalid token response from server")
        val url = response.optString("url").takeIf { it.isNotEmpty() }
        return TokenResponse(token = token, url = url)
    }
}
