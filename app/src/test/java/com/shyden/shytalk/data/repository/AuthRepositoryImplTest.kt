package com.shyden.shytalk.data.repository

import com.google.android.gms.tasks.Tasks
import com.google.firebase.auth.AuthCredential
import com.google.firebase.auth.AuthResult
import com.google.firebase.auth.FirebaseAuth
import com.google.firebase.auth.FirebaseUser
import com.google.firebase.auth.GoogleAuthProvider
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
    fun `currentUser returns auth currentUser`() {
        val user = mockk<FirebaseUser>()
        every { auth.currentUser } returns user
        assertEquals(user, repo.currentUser)
    }

    @Test
    fun `currentUser returns null when not signed in`() {
        every { auth.currentUser } returns null
        assertNull(repo.currentUser)
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
    fun `signInWithGoogleIdToken returns Success on valid user`() = runTest {
        val user = mockk<FirebaseUser>()
        val authResult = mockk<AuthResult> { every { this@mockk.user } returns user }
        val credential = mockk<AuthCredential>()
        every { GoogleAuthProvider.getCredential("token123", null) } returns credential
        every { auth.signInWithCredential(credential) } returns Tasks.forResult(authResult)

        val result = repo.signInWithGoogleIdToken("token123")

        assertTrue(result is Resource.Success)
        assertEquals(user, (result as Resource.Success).data)
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
    fun `signOut calls auth signOut`() {
        repo.signOut()
        verify { auth.signOut() }
    }
}
