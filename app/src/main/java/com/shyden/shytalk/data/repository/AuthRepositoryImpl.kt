package com.shyden.shytalk.data.repository

import com.google.firebase.auth.ActionCodeSettings
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.GoogleAuthProvider
import com.shyden.shytalk.core.util.Resource
import com.shyden.shytalk.core.util.firebaseCall
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.feature.auth.AppleSignInCancelledException
import kotlinx.coroutines.tasks.await

class AuthRepositoryImpl(
    private val auth: FirebaseAuth,
    private val applicationId: String = "com.shyden.shytalk",
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

    override suspend fun signOut() {
        resolvedUniqueId = null
        auth.signOut()
    }
}
