package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFailsWith
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * Locks down behaviour expected from any `AuthRepository.signOut()` impl:
 *
 *  1. It must be callable from a `suspend` context (the inline fake's
 *     `override suspend fun signOut()` enforces this — if the interface ever
 *     regresses to non-suspend without simultaneously reverting this fake,
 *     compilation fails here).
 *  2. `resolvedUniqueId` must be cleared on sign-out, so the next sign-in
 *     starts from a clean slate.
 *  3. Platform exceptions must propagate to the caller rather than be
 *     swallowed (pre-Phase-2J the iOS impl wrapped GitLive's suspend
 *     `auth.signOut()` in `runBlocking`, which silently surfaced any
 *     CancellationException as the synchronous return — caller couldn't
 *     distinguish success from failure).
 */
class AuthRepositorySignOutContractTest {
    @Test
    fun signOut_isCallableFromSuspendContext_clearsResolvedUniqueId() =
        runTest {
            val repo = FakeAuthRepository(initialResolvedUniqueId = "10000007")

            repo.signOut()

            assertTrue(repo.signOutCalled, "signOut should have run")
            assertNull(repo.resolvedUniqueId, "resolvedUniqueId should be cleared on sign-out")
        }

    @Test
    fun signOut_exceptionsPropagateToCaller() =
        runTest {
            val repo = FakeAuthRepository().apply { signOutShouldThrow = true }

            val ex = assertFailsWith<IllegalStateException> { repo.signOut() }

            assertEquals("simulated platform sign-out failure", ex.message)
        }

    private class FakeAuthRepository(
        initialResolvedUniqueId: String? = null,
    ) : AuthRepository {
        var signOutCalled = false
        var signOutShouldThrow = false

        override val currentUserId: String? = null
        override val isAuthenticated: Boolean = false
        override val currentUserEmail: String? = null
        override val currentFirebaseUid: String? = null
        override var resolvedUniqueId: String? = initialResolvedUniqueId

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

        override suspend fun signOut() {
            if (signOutShouldThrow) throw IllegalStateException("simulated platform sign-out failure")
            signOutCalled = true
            resolvedUniqueId = null
        }
    }
}
