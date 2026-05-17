package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Contract test for `AuthRepository.refreshIdToken()` introduced in
 * UK OSA #17 PR 2 (segregation custom-claim plumbing).
 *
 * After a cohort flip the server mints a fresh custom claim, but
 * Firebase doesn't push it — the client's cached JWT still carries
 * the old `cohort` until the next auto-refresh (~1h). To close that
 * window, the `pm-lock-check` response carries `forceTokenRefresh:
 * true` which the repository layer translates into a call here.
 * The platform impl is `auth.currentUser.getIdToken(forceRefresh =
 * true)` on Android and the GitLive equivalent on iOS — both must
 * surface the result as `Resource<Unit>` so the caller can react.
 *
 * The test fixes the call surface (suspend, no parameters,
 * `Resource<Unit>`) AND pins exception propagation — if the platform
 * impl swallows a `FirebaseNetworkException` the user's rules-layer
 * cohort stays stale until the next launch, and callers have no
 * signal to retry. Mirrors `AuthRepositorySignOutContractTest`.
 */
class AuthRepositoryRefreshIdTokenContractTest {
    @Test
    fun refreshIdToken_isCallableFromSuspendContext_returnsSuccessOnHappyPath() =
        runTest {
            val repo = FakeAuthRepository()

            val result = repo.refreshIdToken()

            assertTrue(result is Resource.Success, "happy path should return Resource.Success")
            assertTrue(repo.refreshIdTokenCalled, "refreshIdToken should have run")
        }

    @Test
    fun refreshIdToken_returnsErrorOnPlatformFailure() =
        runTest {
            // Network or quota errors must surface as Resource.Error
            // so the caller can log + decide to retry; swallowing
            // them as Resource.Success would lie about the JWT state
            // and leave rules-layer enforcement stale.
            val repo = FakeAuthRepository().apply { refreshShouldFail = true }

            val result = repo.refreshIdToken()

            assertTrue(result is Resource.Error, "platform failure must surface as Resource.Error")
            assertEquals("simulated network failure", result.message)
        }

    private class FakeAuthRepository : AuthRepository {
        var refreshIdTokenCalled = false
        var refreshShouldFail = false

        override val currentUserId: String? = null
        override val isAuthenticated: Boolean = false
        override val currentUserEmail: String? = null
        override val currentFirebaseUid: String? = null
        override var resolvedUniqueId: String? = null
        override var resolvedDisplayName: String? = null

        override fun getProviderInfo(): Pair<String, String>? = null

        override suspend fun signInWithGoogleIdToken(idToken: String): Resource<String> = Resource.Error("not used")

        override suspend fun signInWithAppleIdToken(
            idToken: String,
            rawNonce: String,
        ): Resource<String> = Resource.Error("not used")

        override suspend fun signInWithAppleViaProvider(activity: Any): Resource<String> = Resource.Error("not used")

        override suspend fun sendSignInLink(email: String): Resource<Unit> = Resource.Error("not used")

        override suspend fun signInWithEmailLink(
            email: String,
            link: String,
        ): Resource<String> = Resource.Error("not used")

        override suspend fun signInWithCustomToken(token: String): Resource<String> = Resource.Error("not used")

        override suspend fun signOut() = Unit

        override suspend fun refreshIdToken(): Resource<Unit> {
            if (refreshShouldFail) return Resource.Error("simulated network failure")
            refreshIdTokenCalled = true
            return Resource.Success(Unit)
        }
    }
}
