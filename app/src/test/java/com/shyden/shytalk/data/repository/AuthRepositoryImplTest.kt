package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.AuthCredential
import com.google.firebase.auth.AuthResult
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
import com.google.firebase.auth.UserInfo
import com.shyden.shytalk.core.util.Resource
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkStatic
import io.mockk.unmockkStatic
import io.mockk.verify
import kotlinx.coroutines.test.runTest
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

class AuthRepositoryImplTest {

    private lateinit var auth: FirebaseAuth
    private lateinit var repo: AuthRepositoryImpl

    @Before
    fun setup() {
        auth = mockk(relaxed = true)
        repo = AuthRepositoryImpl(auth)
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
    fun `signInWithGoogleIdToken returns Success with uid`() = runTest {
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
    fun `signInWithGoogleIdToken returns Error when user is null`() = runTest {
        val authResult = mockk<AuthResult> { every { user } returns null }
        val credential = mockk<AuthCredential>()
        every { GoogleAuthProvider.getCredential("token123", null) } returns credential
        every { auth.signInWithCredential(credential) } returns Tasks.forResult(authResult)

        val result = repo.signInWithGoogleIdToken("token123")

        assertTrue(result is Resource.Error)
        assertEquals("Sign in failed: no user returned", (result as Resource.Error).message)
    }

    @Test
    fun `signInWithGoogleIdToken returns Error on exception`() = runTest {
        val credential = mockk<AuthCredential>()
        every { GoogleAuthProvider.getCredential("token123", null) } returns credential
        every { auth.signInWithCredential(credential) } returns Tasks.forException(RuntimeException("Network error"))

        val result = repo.signInWithGoogleIdToken("token123")

        assertTrue(result is Resource.Error)
        assertTrue((result as Resource.Error).message.contains("Network error"))
    }

    @Test
    fun `signInWithAppleIdToken returns Error on failure`() = runTest {
        // Mock signInWithCredential for any credential to return a failure,
        // since OAuthProvider.newCredentialBuilder is a static Firebase call.
        every { auth.signInWithCredential(any()) } returns Tasks.forException(RuntimeException("Apple sign-in failed"))

        val result = repo.signInWithAppleIdToken("token", "nonce")

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `signOut calls auth signOut`() {
        repo.signOut()
        verify { auth.signOut() }
    }

    @Test
    fun `signOut clears resolvedUniqueId`() {
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
    fun `sendSignInLink calls Firebase sendSignInLinkToEmail`() = runTest {
        every { auth.sendSignInLinkToEmail(any(), any()) } returns Tasks.forResult(null)

        val result = repo.sendSignInLink("user@example.com")

        assertTrue(result is Resource.Success)
        verify { auth.sendSignInLinkToEmail("user@example.com", any()) }
    }

    @Test
    fun `sendSignInLink returns Error on exception`() = runTest {
        every { auth.sendSignInLinkToEmail(any(), any()) } returns
            Tasks.forException(RuntimeException("Send failed"))

        val result = repo.sendSignInLink("user@example.com")

        assertTrue(result is Resource.Error)
    }

    @Test
    fun `signInWithEmailLink authenticates and returns uid`() = runTest {
        val user = mockk<FirebaseUser>()
        every { user.uid } returns "email-user-uid"
        val authResult = mockk<AuthResult> { every { this@mockk.user } returns user }
        every { auth.signInWithEmailLink("user@example.com", "https://link") } returns Tasks.forResult(authResult)

        val result = repo.signInWithEmailLink("user@example.com", "https://link")

        assertTrue(result is Resource.Success)
        assertEquals("email-user-uid", (result as Resource.Success).data)
    }

    @Test
    fun `signInWithEmailLink returns Error on failure`() = runTest {
        every { auth.signInWithEmailLink(any(), any()) } returns
            Tasks.forException(RuntimeException("Invalid link"))

        val result = repo.signInWithEmailLink("user@example.com", "bad-link")

        assertTrue(result is Resource.Error)
    }
}
