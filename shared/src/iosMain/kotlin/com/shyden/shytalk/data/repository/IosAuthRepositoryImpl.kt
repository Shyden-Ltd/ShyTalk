package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.logD
import com.shyden.shytalk.core.util.logI
import com.shyden.shytalk.data.remote.IosApiClient
import dev.gitlive.firebase.auth.FirebaseAuth
import dev.gitlive.firebase.auth.GoogleAuthProvider
import dev.gitlive.firebase.auth.OAuthProvider
import kotlinx.coroutines.flow.map

class IosAuthRepositoryImpl(
    private val auth: FirebaseAuth,
    private val sessionCache: SessionCache,
    private val apiClient: IosApiClient,
    private val emailLinkDomain: String = "shytalk.shyden.co.uk",
) : AuthRepository {
    // SHY-0143 — identical write-through to Android. See AuthRepositoryImpl for
    // why this lives in the setters rather than at each assignment site.
    override var resolvedUniqueId: String? = null
        set(value) {
            field = value
            syncSessionCache()
        }

    override var resolvedDisplayName: String? = null

    override var resolvedCohort: String? = null
        set(value) {
            field = value
            syncSessionCache()
        }

    private fun syncSessionCache() {
        sessionCache.write(
            firebaseUid = auth.currentUser?.uid,
            uniqueId = resolvedUniqueId,
            cohort = resolvedCohort,
        )
    }

    override val currentUserId: String?
        get() = resolvedUniqueId ?: auth.currentUser?.uid

    override val currentFirebaseUid: String?
        get() = auth.currentUser?.uid

    /**
     * Firebase iOS restores its keychain user asynchronously and fires a freshly
     * added auth-state listener at once with whatever it holds — nil until that
     * load finishes. So the SDK's first emission is NOT the keychain load: a
     * wait that returned on it read `currentUser == null`, missed the identity
     * cache, and drew sign-in first for a signed-in person (J40 on the iPhone,
     * 2026-09-05: `Cold-start identity cache miss`, `authenticated=true` 560 ms
     * later). The identity cache's own record is the local sign that a user is
     * coming: with one, hold (bounded) for the emission that carries a user;
     * without one, do not wait at all. No network is involved either way. The
     * wait itself is common code, proven in PersistedSessionOutcomeTest.
     */
    override suspend fun awaitPersistedSession() {
        val outcome =
            awaitRestoredUser(
                expectUser = sessionCache.hasRecord(),
                userIds = auth.authStateChanged.map { it?.uid },
                timeoutMs = PERSISTED_SESSION_TIMEOUT_MS,
            )
        when (outcome) {
            PersistedSessionOutcome.NoneExpected -> logD(TAG, "persisted session: no record, not waiting")

            PersistedSessionOutcome.Restored -> logD(TAG, "persisted session: restored by the SDK")

            is PersistedSessionOutcome.NotRestoredWithin ->
                logI(TAG, "persisted session expected but not reported within ${outcome.timeoutMs}ms; deciding on what is known")
        }
    }

    override val isAuthenticated: Boolean
        get() = auth.currentUser != null

    override val currentUserEmail: String?
        get() = auth.currentUser?.email

    override fun getProviderInfo(): Pair<String, String>? {
        val user = auth.currentUser ?: return null
        for (profile in user.providerData) {
            when (profile.providerId) {
                "google.com" -> {
                    val email = profile.email ?: continue
                    return "google" to email
                }

                "apple.com" -> {
                    return "apple" to profile.uid
                }

                "password" -> {
                    val email = profile.email ?: continue
                    return "email" to email
                }
            }
        }
        return null
    }

    override suspend fun signInWithGoogleIdToken(idToken: String): Resource<String> =
        firebaseCall("Google sign in failed") {
            val credential = GoogleAuthProvider.credential(idToken, null)
            val result = auth.signInWithCredential(credential)
            result.user?.uid ?: throw Exception("Sign in failed: no user returned")
        }

    override suspend fun signInWithAppleIdToken(
        idToken: String,
        rawNonce: String,
    ): Resource<String> =
        firebaseCall("Apple sign-in failed") {
            val credential =
                OAuthProvider.credential(
                    providerId = "apple.com",
                    idToken = idToken,
                    accessToken = null,
                    rawNonce = rawNonce,
                )
            val result = auth.signInWithCredential(credential)
            result.user?.uid ?: throw Exception("Apple sign-in failed: no user returned")
        }

    override suspend fun signInWithAppleViaProvider(activity: Any): Resource<String> =
        // iOS uses ASAuthorizationController, not activity-based flow.
        // Apple sign-in on iOS goes through signInWithAppleIdToken after native auth.
        Resource.Error("Use signInWithAppleIdToken on iOS")

    override suspend fun sendSignInLink(email: String): Resource<Unit> =
        firebaseCall("Failed to send sign-in link") {
            val settings =
                dev.gitlive.firebase.auth.ActionCodeSettings(
                    url = "https://$emailLinkDomain/auth/email-link",
                    canHandleCodeInApp = true,
                    iOSBundleId = "com.shyden.shytalk",
                )
            auth.sendSignInLinkToEmail(email, settings)
        }

    override suspend fun signInWithEmailLink(
        email: String,
        link: String,
    ): Resource<String> =
        firebaseCall("Email sign-in failed") {
            val result = auth.signInWithEmailLink(email, link)
            result.user?.uid ?: throw Exception("Sign in failed: no user returned")
        }

    override suspend fun signInWithCustomToken(token: String): Resource<String> =
        firebaseCall("Custom token sign-in failed") {
            val result = auth.signInWithCustomToken(token)
            result.user?.uid ?: throw Exception("Sign in failed: no user returned")
        }

    override suspend fun signOut() {
        resolvedUniqueId = null
        resolvedDisplayName = null
        resolvedCohort = null
        // SHY-0143 R3 — same as Android: the invariant lives in signOut(), not
        // at each call site. `IosApiClient` caches the bearer token with the
        // identical 50-minute TTL, and none of the three iOS sign-out sites
        // cleared it.
        apiClient.clearTokenCache()
        // SHY-0143 — redundant with the setters' erase, kept for the same
        // reason as Android's, and it matters more here: the Keychain survives
        // app deletion, so anything left behind outlives the uninstall itself.
        sessionCache.clear()
        auth.signOut()
    }

    override suspend fun refreshIdToken(): Resource<Unit> =
        firebaseCall("Failed to refresh ID token") {
            // SHY-0143 R3 — invalidate the API client's cached bearer token
            // FIRST, exactly as Android does. Rotating the Firebase JWT while
            // IosApiClient serves a 50-minute cached one left every Express
            // call on the PRE-flip cohort claim: the SHY-0132/0137 window this
            // story closes, still open on iPhone. Both GATE 2 and the
            // background reconcile reach this.
            apiClient.clearTokenCache()
            // UK OSA #17 PR 2: GitLive's `getIdToken(forceRefresh)`
            // mirrors the Firebase Android `getIdToken(boolean)`
            // contract. Force-refresh after a server-side cohort
            // flip so the rules-layer JWT picks up the new claim
            // immediately rather than waiting ~1h for auto-refresh.
            // `.let { }` discards the returned token string (Firebase
            // rotates the cached JWT in place; subsequent reads pick
            // it up) AND forces the block to return Unit so
            // firebaseCall infers Resource<Unit>.
            val user = auth.currentUser ?: throw IllegalStateException("No signed-in user")
            user.getIdToken(true).let { }
        }
}

/** How long a cold start with a cached identity waits for the SDK to report its persisted user. */
private const val PERSISTED_SESSION_TIMEOUT_MS = 1_500L
private const val TAG = "IosAuthRepository"
