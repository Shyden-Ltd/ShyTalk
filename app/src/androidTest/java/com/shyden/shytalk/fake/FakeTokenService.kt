package com.shyden.shytalk.fake

import com.shyden.shytalk.data.remote.TokenResponse
import com.shyden.shytalk.data.remote.TokenService

class FakeTokenService : TokenService {
    override suspend fun fetchToken(roomName: String): TokenResponse = TokenResponse(token = "fake-token", url = null)
}
