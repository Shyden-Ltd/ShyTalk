package com.shyden.shytalk.fake

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.repository.AuthRepository

class FakeAuthRepository : AuthRepository {
    var fakeUserId: String? = "test-user-1"
    var fakeAuthenticated: Boolean = true
    var fakeUserEmail: String? = "test@example.com"
    var fakeProviderInfo: Pair<String, String>? = "google" to "test@example.com"

    /** Reset to default authenticated state — call between test classes to prevent state leakage */
    fun reset() {
        fakeUserId = "test-user-1"
        fakeAuthenticated = true
        fakeUserEmail = "test@example.com"
        fakeProviderInfo = "google" to "test@example.com"
        resolvedUniqueId = null
    }

    override var resolvedUniqueId: String? = null
    override val currentUserId: String? get() = resolvedUniqueId ?: fakeUserId
    override val currentFirebaseUid: String? get() = fakeUserId
    override val isAuthenticated: Boolean get() = fakeAuthenticated
    override val currentUserEmail: String? get() = fakeUserEmail

    override fun getProviderInfo(): Pair<String, String>? = fakeProviderInfo

    override suspend fun signInWithGoogleIdToken(idToken: String): Resource<String> {
        fakeAuthenticated = true
        fakeUserId = "test-user-1"
        return Resource.Success("test-user-1")
    }

    override suspend fun signInWithAppleIdToken(
        idToken: String,
        rawNonce: String,
    ): Resource<String> {
        fakeAuthenticated = true
        fakeUserId = "test-user-1"
        return Resource.Success("test-user-1")
    }

    override suspend fun signInWithAppleViaProvider(activity: Any): Resource<String> {
        fakeAuthenticated = true
        fakeUserId = "test-user-1"
        return Resource.Success("test-user-1")
    }

    override suspend fun sendSignInLink(email: String): Resource<Unit> = Resource.Success(Unit)

    override suspend fun signInWithEmailLink(
        email: String,
        link: String,
    ): Resource<String> {
        fakeAuthenticated = true
        fakeUserId = "test-user-1"
        return Resource.Success("test-user-1")
    }

    override suspend fun signInWithCustomToken(token: String): Resource<String> {
        fakeAuthenticated = true
        fakeUserId = "test-user-1"
        return Resource.Success("test-user-1")
    }

    override fun signOut() {
        resolvedUniqueId = null
        fakeAuthenticated = false
        fakeUserId = null
    }
}
