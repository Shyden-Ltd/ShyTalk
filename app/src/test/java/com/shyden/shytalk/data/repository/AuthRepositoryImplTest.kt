package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.AuthCredential
import com.google.firebase.auth.AuthResult
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.auth.UserInfo
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.data.remote.WorkerApiClient
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkStatic
import io.mockk.slot
import io.mockk.unmockkStatic
import io.mockk.verify
import io.mockk.verifyOrder
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AuthRepositoryImplTest {
    private lateinit var auth: FirebaseAuth
    private lateinit var workerApiClient: WorkerApiClient
    private lateinit var repo: AuthRepositoryImpl

    @Before
    fun setup() {
        auth = mockk(relaxed = true)
        workerApiClient = mockk(relaxed = true)
        // SHY-0143 — a real SessionCache over a relaxed storage double. This
        // file tests auth, not caching; the cache's own behaviour is covered
        // by SessionCacheContractTest against the real SecureStorage actual.
        // (`app/src/test` is a host unit-test source set, where CLAUDE.md
        // permits doubles; the Android SecureStorage actual needs a real
        // Context and Keystore and cannot be built here.)
        repo = AuthRepositoryImpl(auth, SessionCache(mockk(relaxed = true)), workerApiClient)
        mockkStatic(GoogleAuthProvider::class)
    }

    @After
    fun tearDown() {
        unmockkStatic(GoogleAuthProvider::class)
    }

    @Test
    fun `currentUserId returns uid when signed in`() {
        val user = mockk<FirebaseUser>()
        every { user.uid } returns "test-uid"
        every { auth.currentUser } returns user
        assertEquals("test-uid", repo.currentUserId)
    }

    @Test
    fun `currentUserId returns null when not signed in`() {
        every { auth.currentUser } returns null
        assertNull(repo.currentUserId)
    }

    @Test
    fun `isAuthenticated returns true when user exists`() {
        every { auth.currentUser } returns mockk()
        assertTrue(repo.isAuthenticated)
    }

    @Test
    fun `isAuthenticated returns false when no user`() {
        every { auth.currentUser } returns null
        assertFalse(repo.isAuthenticated)
    }

    @Test
    fun `signInWithGoogleIdToken returns Success with uid`() =
        runTest {
            val user = mockk<FirebaseUser>()
            every { user.uid } returns "signed-in-uid"
            val authResult = mockk<AuthResult> { every { this@mockk.user } returns user }
            val credential = mockk<AuthCredential>()
            every { GoogleAuthProvider.getCredential("token123", null) } returns credential
            every { auth.signInWithCredential(credential) } returns Tasks.forResult(authResult)

            val result = repo.signInWithGoogleIdToken("token123")

            assertTrue(result is Resource.Success)
            assertEquals("signed-in-uid", (result as Resource.Success).data)
        }

    @Test
    fun `signInWithGoogleIdToken returns Error when user is null`() =
        runTest {
            val authResult = mockk<AuthResult> { every { user } returns null }
            val credential = mockk<AuthCredential>()
            every { GoogleAuthProvider.getCredential("token123", null) } returns credential
            every { auth.signInWithCredential(credential) } returns Tasks.forResult(authResult)

            val result = repo.signInWithGoogleIdToken("token123")

            assertTrue(result is Resource.Error)
            assertEquals("Sign in failed: no user returned", (result as Resource.Error).message)
        }

    @Test
    fun `signInWithGoogleIdToken returns Error on exception`() =
        runTest {
            val credential = mockk<AuthCredential>()
            every { GoogleAuthProvider.getCredential("token123", null) } returns credential
            every { auth.signInWithCredential(credential) } returns Tasks.forException(RuntimeException("Network error"))

            val result = repo.signInWithGoogleIdToken("token123")

            assertTrue(result is Resource.Error)
            assertTrue((result as Resource.Error).message.contains("Network error"))
        }

    @Test
    fun `signInWithAppleIdToken returns Error on failure`() =
        runTest {
            // Mock signInWithCredential for any credential to return a failure,
            // since OAuthProvider.newCredentialBuilder is a static Firebase call.
            every { auth.signInWithCredential(any()) } returns Tasks.forException(RuntimeException("Apple sign-in failed"))

            val result = repo.signInWithAppleIdToken("token", "nonce")

            assertTrue(result is Resource.Error)
        }

    @Test
    fun `signInWithAppleIdToken builds credential via setIdTokenWithRawNonce, never via setAccessToken(rawNonce)`() =
        runTest {
            // Regression test for the "AccessToken must not be null" bug. The
            // pre-fix code called .setAccessToken(rawNonce) — semantically wrong
            // because Apple does not issue an access_token, so Firebase backend
            // would reject the credential as if accessToken were null. The
            // correct API for Apple is .setIdTokenWithRawNonce(idToken, rawNonce)
            // which sets BOTH idToken + rawNonce (and leaves accessToken unset).
            //
            // We can't verify the resulting credential's internal accessToken
            // field directly because OAuthCredential's getters require a real
            // Firebase Android runtime. Instead, capture the credential and
            // assert it's a real OAuthCredential whose getAccessToken() does
            // NOT equal the rawNonce. The pre-fix code would fail this because
            // the rawNonce gets stored in the accessToken slot.
            val credentialSlot = slot<AuthCredential>()
            every { auth.signInWithCredential(capture(credentialSlot)) } returns
                Tasks.forException(RuntimeException("short-circuit"))

            repo.signInWithAppleIdToken("idtoken-X", "rawnonce-Y")

            val captured = credentialSlot.captured
            assertTrue(
                "Expected OAuthCredential, got ${captured::class.simpleName}",
                captured is com.google.firebase.auth.OAuthCredential,
            )
            val oauth = captured as com.google.firebase.auth.OAuthCredential
            assertEquals("idtoken-X", oauth.idToken)
            // Pre-fix bug: accessToken contained "rawnonce-Y". Post-fix: null.
            assertFalse(
                "rawNonce must NOT be stored as accessToken — that's the bug. accessToken=${oauth.accessToken}",
                oauth.accessToken == "rawnonce-Y",
            )
        }

    @Test
    fun `signOut calls auth signOut`() =
        runTest {
            repo.signOut()
            verify { auth.signOut() }
        }

    @Test
    fun `signOut clears resolvedUniqueId`() =
        runTest {
            repo.resolvedUniqueId = "10000005"
            repo.signOut()
            assertNull(repo.resolvedUniqueId)
        }

    // ===== currentFirebaseUid =====

    @Test
    fun `currentFirebaseUid returns firebase uid`() {
        val user = mockk<FirebaseUser>()
        every { user.uid } returns "firebase-uid-1"
        every { auth.currentUser } returns user
        assertEquals("firebase-uid-1", repo.currentFirebaseUid)
    }

    @Test
    fun `currentFirebaseUid returns null when not signed in`() {
        every { auth.currentUser } returns null
        assertNull(repo.currentFirebaseUid)
    }

    // ===== resolvedUniqueId =====

    @Test
    fun `currentUserId prefers resolvedUniqueId over firebase uid`() {
        val user = mockk<FirebaseUser>()
        every { user.uid } returns "firebase-uid-1"
        every { auth.currentUser } returns user

        repo.resolvedUniqueId = "10000005"
        assertEquals("10000005", repo.currentUserId)
    }

    @Test
    fun `currentUserId falls back to firebase uid when resolvedUniqueId is null`() {
        val user = mockk<FirebaseUser>()
        every { user.uid } returns "firebase-uid-1"
        every { auth.currentUser } returns user

        assertNull(repo.resolvedUniqueId)
        assertEquals("firebase-uid-1", repo.currentUserId)
    }

    // ===== getProviderInfo =====

    @Test
    fun `getProviderInfo returns null when not signed in`() {
        every { auth.currentUser } returns null
        assertNull(repo.getProviderInfo())
    }

    @Test
    fun `getProviderInfo returns google provider with email`() {
        val googleProfile = mockk<UserInfo>()
        every { googleProfile.providerId } returns GoogleAuthProvider.PROVIDER_ID
        every { googleProfile.email } returns "alice@gmail.com"

        val user = mockk<FirebaseUser>()
        every { user.providerData } returns listOf(googleProfile)
        every { auth.currentUser } returns user

        val result = repo.getProviderInfo()
        assertEquals("google" to "alice@gmail.com", result)
    }

    @Test
    fun `getProviderInfo returns apple provider with uid`() {
        val appleProfile = mockk<UserInfo>()
        every { appleProfile.providerId } returns "apple.com"
        every { appleProfile.uid } returns "001234.abcdef"

        val user = mockk<FirebaseUser>()
        every { user.providerData } returns listOf(appleProfile)
        every { auth.currentUser } returns user

        val result = repo.getProviderInfo()
        assertEquals("apple" to "001234.abcdef", result)
    }

    @Test
    fun `getProviderInfo returns email provider`() {
        val emailProfile = mockk<UserInfo>()
        every { emailProfile.providerId } returns "password"
        every { emailProfile.email } returns "user@example.com"

        val user = mockk<FirebaseUser>()
        every { user.providerData } returns listOf(emailProfile)
        every { auth.currentUser } returns user

        val result = repo.getProviderInfo()
        assertEquals("email" to "user@example.com", result)
    }

    @Test
    fun `getProviderInfo skips firebase provider and returns google`() {
        val firebaseProfile = mockk<UserInfo>()
        every { firebaseProfile.providerId } returns "firebase"

        val googleProfile = mockk<UserInfo>()
        every { googleProfile.providerId } returns GoogleAuthProvider.PROVIDER_ID
        every { googleProfile.email } returns "alice@gmail.com"

        val user = mockk<FirebaseUser>()
        every { user.providerData } returns listOf(firebaseProfile, googleProfile)
        every { auth.currentUser } returns user

        val result = repo.getProviderInfo()
        assertEquals("google" to "alice@gmail.com", result)
    }

    @Test
    fun `getProviderInfo returns null for google without email`() {
        val googleProfile = mockk<UserInfo>()
        every { googleProfile.providerId } returns GoogleAuthProvider.PROVIDER_ID
        every { googleProfile.email } returns null

        val user = mockk<FirebaseUser>()
        every { user.providerData } returns listOf(googleProfile)
        every { auth.currentUser } returns user

        assertNull(repo.getProviderInfo())
    }

    // ===== Email sign-in =====

    @Test
    fun `sendSignInLink calls Firebase sendSignInLinkToEmail`() =
        runTest {
            every { auth.sendSignInLinkToEmail(any(), any()) } returns Tasks.forResult(null)

            val result = repo.sendSignInLink("user@example.com")

            assertTrue(result is Resource.Success)
            verify { auth.sendSignInLinkToEmail("user@example.com", any()) }
        }

    @Test
    fun `sendSignInLink returns Error on exception`() =
        runTest {
            every { auth.sendSignInLinkToEmail(any(), any()) } returns
                Tasks.forException(RuntimeException("Send failed"))

            val result = repo.sendSignInLink("user@example.com")

            assertTrue(result is Resource.Error)
        }

    @Test
    fun `signInWithEmailLink authenticates and returns uid`() =
        runTest {
            val user = mockk<FirebaseUser>()
            every { user.uid } returns "email-user-uid"
            val authResult = mockk<AuthResult> { every { this@mockk.user } returns user }
            every { auth.signInWithEmailLink("user@example.com", "https://link") } returns Tasks.forResult(authResult)

            val result = repo.signInWithEmailLink("user@example.com", "https://link")

            assertTrue(result is Resource.Success)
            assertEquals("email-user-uid", (result as Resource.Success).data)
        }

    @Test
    fun `signInWithEmailLink returns Error on failure`() =
        runTest {
            every { auth.signInWithEmailLink(any(), any()) } returns
                Tasks.forException(RuntimeException("Invalid link"))

            val result = repo.signInWithEmailLink("user@example.com", "bad-link")

            assertTrue(result is Resource.Error)
        }

    // region refreshIdToken (UK OSA #17 PR 2)

    @Test
    fun `refreshIdToken calls getIdToken with forceRefresh=true on success`() =
        runTest {
            val user = mockk<FirebaseUser>(relaxed = true)
            every { auth.currentUser } returns user
            every { user.getIdToken(true) } returns Tasks.forResult(mockk(relaxed = true))

            val result = repo.refreshIdToken()

            assertTrue(result is Resource.Success)
            verify { user.getIdToken(true) }
        }

    @Test
    fun `refreshIdToken returns Error when no signed-in user`() =
        runTest {
            // Edge case flagged by review: no current user → must
            // surface as Resource.Error so the AuthViewModel caller
            // can log + retry, not as a silent Success.
            every { auth.currentUser } returns null

            val result = repo.refreshIdToken()

            assertTrue(result is Resource.Error)
        }

    @Test
    fun `refreshIdToken returns Error when getIdToken fails`() =
        runTest {
            // Platform error (FirebaseNetworkException, quota) — must
            // surface so the rules-layer staleness is visible.
            val user = mockk<FirebaseUser>(relaxed = true)
            every { auth.currentUser } returns user
            every { user.getIdToken(true) } returns
                Tasks.forException(RuntimeException("Network error"))

            val result = repo.refreshIdToken()

            assertTrue(result is Resource.Error)
        }

    // endregion

    // region SHY-0143 — the resolved identity writes through to the cache

    /**
     * A real [SessionCache] over an in-memory storage double, so these tests
     * exercise the REAL write-through path: `AuthRepositoryImpl`'s setters →
     * `SessionCache.write` → storage. Only the leaf — the Keystore-backed
     * `SecureStorage` actual, which needs a real Context — is stood in for.
     */
    private fun cacheOverMemory(): Pair<SessionCache, MutableMap<String, String>> {
        val backing = mutableMapOf<String, String>()
        val storage =
            mockk<com.shyden.shytalk.core.util.SecureStorage>(relaxed = true) {
                every { getString(any()) } answers { backing[firstArg()] }
                every { putString(any(), any()) } answers { backing[firstArg()] = secondArg() }
                every { remove(any()) } answers { backing -= firstArg<String>() }
            }
        return SessionCache(storage) to backing
    }

    private fun signedInAs(uid: String) {
        val user = mockk<FirebaseUser>(relaxed = true)
        every { user.uid } returns uid
        every { auth.currentUser } returns user
    }

    @Test
    fun `a fully resolved identity is written through to the cache`() {
        // Without this, the cache is never populated and every returning user
        // takes the resolve-then-route fallback forever — the feature silently
        // does nothing while every test about the cache itself stays green.
        val (cache, _) = cacheOverMemory()
        val repoWithCache = AuthRepositoryImpl(auth, cache, workerApiClient)
        signedInAs("fb-uid-1")

        repoWithCache.resolvedUniqueId = "10000005"
        repoWithCache.resolvedCohort = "adult"

        val cached = cache.read("fb-uid-1")
        assertNotNull(cached)
        assertEquals("10000005", cached!!.uniqueId)
        assertEquals("adult", cached.cohort)
    }

    @Test
    fun `an identity resolved before its cohort is cached anyway`() {
        // This test used to assert the opposite, and that assertion was the bug
        // wearing a test's clothes. Because the write-through fires from each
        // setter independently, requiring a cohort meant `LockScreenViewModel`
        // — which sets only the uniqueId after verifying a PIN — drove the
        // cache into its erase branch, so a successful unlock wiped it. Cohort
        // is metadata, not identity.
        val (cache, _) = cacheOverMemory()
        val repoWithCache = AuthRepositoryImpl(auth, cache, workerApiClient)
        signedInAs("fb-uid-1")

        repoWithCache.resolvedUniqueId = "10000005"

        val cached = cache.read("fb-uid-1")
        assertNotNull(cached)
        assertEquals("10000005", cached!!.uniqueId)
        assertNull("the cohort is simply not known yet", cached.cohort)
    }

    @Test
    fun `an identity with no uniqueId is not cached`() {
        // The half that IS still forbidden: without a uniqueId there is nothing
        // to route on, and leaving the previous account's record behind would
        // let the next launch trust it.
        val (cache, _) = cacheOverMemory()
        val repoWithCache = AuthRepositoryImpl(auth, cache, workerApiClient)
        signedInAs("fb-uid-1")

        repoWithCache.resolvedCohort = "adult"

        assertNull(cache.read("fb-uid-1"))
    }

    @Test
    fun `signOut leaves no identity on disk`() =
        runTest {
            val (cache, backing) = cacheOverMemory()
            val repoWithCache = AuthRepositoryImpl(auth, cache, workerApiClient)
            signedInAs("fb-uid-1")
            repoWithCache.resolvedUniqueId = "10000005"
            repoWithCache.resolvedCohort = "adult"
            assertNotNull(cache.read("fb-uid-1"))

            repoWithCache.signOut()

            assertNull(cache.read("fb-uid-1"))
            assertTrue(
                "no session field may survive sign-out, got ${backing.keys}",
                backing.keys.none { it.startsWith("session_cache_") },
            )
        }

    @Test
    fun `refreshIdToken invalidates the API client's cached bearer token`() =
        runTest {
            // Without this, rotating Firebase's token leaves WorkerApiClient
            // serving the PRE-flip token for up to 50 minutes — so every
            // Express call still carries the old cohort claim. That is the
            // SHY-0132/0137 window this story closes, reopened by the refresh
            // meant to close it. `IdentityRepositoryImpl.forceRefreshToken`
            // already clears it; this path did not.
            val user = mockk<FirebaseUser>(relaxed = true)
            every { auth.currentUser } returns user
            every { user.getIdToken(true) } returns Tasks.forResult(mockk(relaxed = true))

            repo.refreshIdToken()

            // ORDER is load-bearing, and the production comment says so:
            // clearing AFTER the rotate leaves the stale token in place
            // whenever `getIdToken(true)` throws.
            verifyOrder {
                workerApiClient.clearTokenCache()
                user.getIdToken(true)
            }
        }

    // endregion
}
