package com.shyden.shytalk.data.remote

interface TokenService {
    suspend fun fetchToken(
        roomName: String,
        identity: String,
    ): String
}
