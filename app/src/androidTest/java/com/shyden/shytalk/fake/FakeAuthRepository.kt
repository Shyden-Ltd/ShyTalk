package com.shyden.shytalk.fake

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository

class FakeAuthRepository : AuthRepository {
    var _currentUserId: String? = "test-user-1"
    var _isAuthenticated: Boolean = true
    var _currentUserEmail: String? = "test@example.com"

    override val currentUserId: String? get() = _currentUserId
    override val isAuthenticated: Boolean get() = _isAuthenticated
    override val currentUserEmail: String? get() = _currentUserEmail

    override suspend fun signInWithGoogleIdToken(idToken: String): Resource<String> {
        _isAuthenticated = true
        _currentUserId = "test-user-1"
        return Resource.Success("test-user-1")
    }

    override suspend fun signInWithAppleIdToken(idToken: String, rawNonce: String): Resource<String> {
        _isAuthenticated = true
        _currentUserId = "test-user-1"
        return Resource.Success("test-user-1")
    }

    override fun signOut() {
        _isAuthenticated = false
        _currentUserId = null
    }
}
