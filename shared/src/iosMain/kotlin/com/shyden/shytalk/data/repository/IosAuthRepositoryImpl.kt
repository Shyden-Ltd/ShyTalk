package com.shyden.shytalk.data.repository

import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import dev.gitlive.firebase.auth.FirebaseAuth
import dev.gitlive.firebase.auth.GoogleAuthProvider
import dev.gitlive.firebase.auth.OAuthProvider

class IosAuthRepositoryImpl(
    private val auth: FirebaseAuth,
    private val emailLinkDomain: String = "shytalk.shyden.co.uk",
) : AuthRepository {
    override var resolvedUniqueId: String? = null

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
        auth.signOut()
    }

    override suspend fun refreshIdToken(): Resource<Unit> =
        firebaseCall("Failed to refresh ID token") {
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
