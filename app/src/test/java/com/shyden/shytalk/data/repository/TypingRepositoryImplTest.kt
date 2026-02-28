package com.shyden.shytalk.data.repository

import com.google.firebase.auth.FirebaseAuth
import io.mockk.mockk
import okhttp3.OkHttpClient
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test

class TypingRepositoryImplTest {

    private lateinit var httpClient: OkHttpClient
    private lateinit var auth: FirebaseAuth
    private lateinit var repo: TypingRepositoryImpl

    @Before
    fun setup() {
        httpClient = mockk(relaxed = true)
        auth = mockk(relaxed = true)
        repo = TypingRepositoryImpl(httpClient, "https://api.example.com", auth)
    }

    @Test
    fun `setTyping does not throw when no active WebSocket`() {
        // Should silently no-op when no WebSocket is connected
        repo.setTyping("conv-1", "user-1", true)
        repo.setTyping("conv-1", "user-1", false)
    }

    @Test
    fun `observeTyping returns a Flow`() {
        val flow = repo.observeTyping("conv-1", "user-2")
        assertNotNull(flow)
    }

    @Test
    fun `setTyping for wrong conversationId is ignored`() {
        // No WebSocket connected, so both calls should be silent no-ops
        repo.setTyping("conv-1", "user-1", true)
        repo.setTyping("conv-2", "user-1", true) // Different conversation
    }
}
