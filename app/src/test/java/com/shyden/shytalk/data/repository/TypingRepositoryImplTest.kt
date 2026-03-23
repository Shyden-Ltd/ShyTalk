package com.shyden.shytalk.data.repository

import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for RtdbTypingRepository.
 *
 * Note: RTDB interactions require the Firebase emulator for integration testing.
 * These unit tests verify the service can be created and basic API contracts hold.
 * Full integration testing is done via E2E tests (connectedDebugAndroidTest).
 */
class TypingRepositoryImplTest {
    private lateinit var repo: RtdbTypingRepository

    @Before
    fun setup() {
        repo = RtdbTypingRepository()
    }

    @Test
    fun `repository implements TypingRepository interface`() {
        val typingRepo: TypingRepository = repo
        assertNotNull(typingRepo)
    }

    @Test
    fun `observeTyping returns a Flow`() {
        val flow = repo.observeTyping("conv-1", "user-2")
        assertNotNull(flow)
    }
}
