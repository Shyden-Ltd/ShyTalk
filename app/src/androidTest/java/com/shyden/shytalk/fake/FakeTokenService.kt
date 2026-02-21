package com.shyden.shytalk.fake

import com.shyden.shytalk.data.remote.TokenService

class FakeTokenService : TokenService {
    override suspend fun fetchToken(roomName: String, identity: String): String = "fake-token"
}
