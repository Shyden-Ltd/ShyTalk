package com.shyden.shytalk.fake

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository

class FakeAuthRepository : AuthRepository {
    var _currentUserId: String? = "test-user-1"
    var _isAuthenticated: Boolean = true
    var _currentUserEmail: String? = "test@example.com"
    var _providerInfo: Pair<String, String>? = "google" to "test@example.com"

    /** Reset to default authenticated state — call between test classes to prevent state leakage */
    fun reset() {
        _currentUserId = "test-user-1"
        _isAuthenticated = true
        _currentUserEmail = "test@example.com"
        _providerInfo = "google" to "test@example.com"
        resolvedUniqueId = null
    }

    override var resolvedUniqueId: String? = null
    override val currentUserId: String? get() = resolvedUniqueId ?: _currentUserId
    override val currentFirebaseUid: String? get() = _currentUserId
    override val isAuthenticated: Boolean get() = _isAuthenticated
    override val currentUserEmail: String? get() = _currentUserEmail

    override fun getProviderInfo(): Pair<String, String>? = _providerInfo

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

    override suspend fun signInWithAppleViaProvider(activity: Any): Resource<String> {
        _isAuthenticated = true
        _currentUserId = "test-user-1"
        return Resource.Success("test-user-1")
    }

    override suspend fun sendSignInLink(email: String): Resource<Unit> = Resource.Success(Unit)

    override suspend fun signInWithEmailLink(email: String, link: String): Resource<String> {
        _isAuthenticated = true
        _currentUserId = "test-user-1"
        return Resource.Success("test-user-1")
    }

    override fun signOut() {
        resolvedUniqueId = null
        _isAuthenticated = false
        _currentUserId = null
    }
}
