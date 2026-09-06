package com.shyden.shytalk.data.repository

import com.google.firebase.auth.ActionCodeSettings
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.logD
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.data.remote.WorkerApiClient
import com.shyden.shytalk.feature.auth.AppleSignInCancelledException
import kotlinx.coroutines.tasks.await

class AuthRepositoryImpl(
    private val auth: FirebaseAuth,
    private val sessionCache: SessionCache,
    private val workerApiClient: WorkerApiClient,
    private val applicationId: String = "com.shyden.shytalk",
    private val emailLinkDomain: String = "shytalk.shyden.co.uk",
) : AuthRepository {
    // SHY-0143 — the two identity slots write through to encrypted storage so a
    // cold start can key its reads on the real uniqueId. Custom setters rather
    // than explicit calls at each assignment site: there are four across the
    // codebase today, and a fifth added later would silently skip the cache.
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

    /**
     * Mirrors the resolved identity onto disk.
     *
     * Identity arrives in stages — the uniqueId when the backend resolves it,
     * the cohort only once the User doc loads — so this runs while the record
     * is still incomplete. [SessionCache.write] erases rather than half-writes
     * in that case, which is correct: at that instant there genuinely is no
     * complete identity to cache. The window closes microseconds later, and if
     * the process dies inside it the next launch simply takes the
     * resolve-then-route fallback.
     */
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

    override val isAuthenticated: Boolean
        get() = auth.currentUser != null

    override val currentUserEmail: String?
        get() = auth.currentUser?.email

    override fun getProviderInfo(): Pair<String, String>? {
        val user = auth.currentUser ?: return null
        for (profile in user.providerData) {
            when (profile.providerId) {
                GoogleAuthProvider.PROVIDER_ID -> {
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
            val credential = GoogleAuthProvider.getCredential(idToken, null)
            val result = auth.signInWithCredential(credential).await()
            result.user?.uid ?: throw Exception("Sign in failed: no user returned")
        }

    override suspend fun signInWithAppleIdToken(
        idToken: String,
        rawNonce: String,
    ): Resource<String> {
        return try {
            // Apple Sign-In on Firebase requires setIdTokenWithRawNonce,
            // which stores BOTH idToken + rawNonce on the credential and
            // leaves accessToken unset. Apple does NOT issue an
            // access_token, so the prior .setAccessToken(rawNonce) call
            // stuffed the nonce into the wrong field — Firebase backend
            // would reject the credential as malformed, surfacing the
            // generic "AccessToken must not be null" error.
            val credential =
                com.google.firebase.auth.OAuthProvider
                    .newCredentialBuilder("apple.com")
                    .setIdTokenWithRawNonce(idToken, rawNonce)
                    .build()
            val authResult = auth.signInWithCredential(credential).await()
            val uid = authResult.user?.uid ?: return Resource.Error("Apple sign-in failed")
            Resource.Success(uid)
        } catch (e: com.google.firebase.auth.FirebaseAuthUserCollisionException) {
            logE("AuthRepository", "Apple sign-in: user collision", e)
            Resource.Error("An account already exists with this email using a different sign-in method")
        } catch (e: Exception) {
            // Log the underlying exception so a future credential
            // malformation (the bug class fixed here) doesn't go
            // undiagnosed under the generic "Apple sign-in failed"
            // Resource.Error.
            logE("AuthRepository", "Apple sign-in failed", e)
            Resource.Error("Apple sign-in failed")
        }
    }

    override suspend fun signInWithAppleViaProvider(activity: Any): Resource<String> {
        return try {
            val act = activity as android.app.Activity
            val pending = auth.pendingAuthResult
            val authResult =
                if (pending != null) {
                    pending.await()
                } else {
                    val provider =
                        com.google.firebase.auth.OAuthProvider
                            .newBuilder("apple.com")
                            .setScopes(listOf("email", "name"))
                            .build()
                    auth.startActivityForSignInWithProvider(act, provider).await()
                }
            val uid = authResult.user?.uid ?: return Resource.Error("Apple sign-in failed")
            Resource.Success(uid)
        } catch (e: com.google.firebase.auth.FirebaseAuthUserCollisionException) {
            Resource.Error("An account already exists with this email using a different sign-in method")
        } catch (e: com.google.firebase.auth.FirebaseAuthWebException) {
            // Cross-platform parity with iOS — both platforms now signal
            // user cancel via the typed `AppleSignInCancelledException`
            // attached to `Resource.Error.exception`. AuthViewModel
            // branches on the type and silences the snackbar without
            // an English-literal `result.message` string match.
            // The `message` is kept human-readable for log breadcrumbs
            // (Sentry, logcat) — it is NOT shown to the user.
            Resource.Error("Apple Sign-In cancelled by user", AppleSignInCancelledException())
        } catch (e: Exception) {
            Resource.Error("Apple sign-in failed. Please try again.")
        }
    }

    override suspend fun sendSignInLink(email: String): Resource<Unit> =
        firebaseCall("Failed to send sign-in link") {
            val actionCodeSettings =
                ActionCodeSettings
                    .newBuilder()
                    .setUrl("https://$emailLinkDomain/auth/email-link")
                    .setHandleCodeInApp(true)
                    .setAndroidPackageName(applicationId, true, null)
                    .build()
            auth.sendSignInLinkToEmail(email, actionCodeSettings).await()
        }

    override suspend fun signInWithEmailLink(
        email: String,
        link: String,
    ): Resource<String> =
        firebaseCall("Email sign-in failed") {
            val result = auth.signInWithEmailLink(email, link).await()
            result.user?.uid ?: throw Exception("Sign in failed: no user returned")
        }

    override suspend fun signInWithCustomToken(token: String): Resource<String> =
        firebaseCall("Custom token sign-in failed") {
            val result = auth.signInWithCustomToken(token).await()
            result.user?.uid ?: throw Exception("Sign in failed: no user returned")
        }

    /**
     * Nothing to wait for on Android: the SDK restores its current user
     * synchronously while FirebaseAuth initialises, so `currentUser` is
     * already right when a cold start asks. Stated here, not defaulted on the
     * interface, so a platform that forgets the wait fails to compile
     * (SHY-0500 — the iPhone did forget, and drew sign-in for a signed-in
     * person).
     */
    override suspend fun awaitPersistedSession() = Unit

    override suspend fun signOut() {
        // SHY-0497: the app has been observed back on Home AFTER sign-out
        // reached the sign-in screen, and nothing in the log said so -- there
        // was no sign-out logging at all. Diagnosing a race needs both ends of
        // it timestamped.
        val signingOut = resolvedUniqueId
        logD("AuthRepository", "signOut: starting for uniqueId=$signingOut")
        resolvedUniqueId = null
        resolvedDisplayName = null
        resolvedCohort = null
        // SHY-0143 R3 — the API token cache is cleared HERE, not at each call
        // site. `WorkerApiClient` caches the bearer token for 50 minutes, and
        // signing out did not touch it, so a signed-out (or banned) process
        // kept a working token in memory. The invariant was being copied per
        // call site and had reached 2 of 4 on Android and 0 of 3 on iOS —
        // including the ban screen Android actually renders. Owning it here
        // makes every present and future sign-out correct by default.
        workerApiClient.clearTokenCache()
        // SHY-0143 — deliberately redundant, and mutation testing says so:
        // deleting this line leaves the suite green, because nulling the two
        // slots above already drove `SessionCache.write` into its erase branch.
        // It stays because the story's requirement is "sign-out leaves nothing
        // on disk", and a requirement stated at the site that owns it survives
        // a later refactor of the setters. Costs one no-op storage remove.
        sessionCache.clear()
        auth.signOut()
        logD(
            "AuthRepository",
            "signOut: complete for uniqueId=$signingOut; firebase user=${auth.currentUser?.uid}",
        )
    }

    override suspend fun refreshIdToken(): Resource<Unit> =
        firebaseCall("Failed to refresh ID token") {
            // SHY-0143 — invalidate the API client's cached bearer token FIRST.
            //
            // `WorkerApiClient` caches the ID token for 50 minutes. Rotating
            // Firebase's token without clearing that cache means every Express
            // call for the next ~50 minutes still carries the PRE-flip cohort
            // claim — which is the SHY-0132/0137 window this story exists to
            // close, reopened by the refresh meant to close it. The
            // cohort-flip path is the one that makes it reachable: the
            // pm-lock-check request itself repopulates the cache with the old
            // token moments before the server mints the new claim.
            //
            // `IdentityRepositoryImpl.forceRefreshToken()` already does this;
            // this method did not, and both are called for the same purpose.
            workerApiClient.clearTokenCache()
            // UK OSA #17 PR 2: force-refresh after a server-side
            // cohort flip so the rules-layer JWT picks up the new
            // claim immediately rather than waiting for the ~1h
            // auto-refresh. Pass `forceRefresh = true` to bypass
            // Firebase's local cache.
            val user = auth.currentUser ?: throw IllegalStateException("No signed-in user")
            user.getIdToken(true).await()
        }
}
