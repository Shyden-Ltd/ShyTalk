package com.shyden.shytalk.data.remote

data class TokenResponse(
    val token: String,
    val url: String? = null,
)

fun interface TokenService {
    suspend fun fetchToken(roomName: String): TokenResponse
}
