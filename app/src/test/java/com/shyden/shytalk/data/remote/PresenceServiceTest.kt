package com.shyden.shytalk.data.remote

import io.mockk.mockk
import okhttp3.OkHttpClient
import org.junit.Assert.assertNotNull
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for RtdbPresenceService.
 *
 * Note: RTDB interactions (setValue, onDisconnect, addValueEventListener) are
 * Firebase SDK calls that require the Firebase emulator for integration testing.
 * These unit tests verify the service can be created and basic API contracts hold.
 * Full integration testing is done via E2E tests (connectedDebugAndroidTest).
 */
class PresenceServiceTest {
    private lateinit var httpClient: OkHttpClient
    private lateinit var presenceService: RtdbPresenceService

    @Before
    fun setup() {
        httpClient = mockk(relaxed = true)
        presenceService = RtdbPresenceService(httpClient, "https://api.example.com")
    }

    @Test
    fun `service implements PresenceService interface`() {
        val service: PresenceService = presenceService
        assertNotNull(service)
    }

    @Test
    fun `observeRoomPresence returns a Flow`() {
        val flow = presenceService.observeRoomPresence("room-1")
        assertNotNull(flow)
    }

    @Test
    fun `roomEvents returns a Flow`() {
        val flow = presenceService.roomEvents
        assertNotNull(flow)
    }

    @Test
    fun `removePresence is safe when not connected`() {
        // Should not throw when called without setPresence
        presenceService.removePresence()
    }

    @Test
    fun `removePresence called twice is safe`() {
        // Regression: ensure double-remove doesn't throw
        presenceService.removePresence()
        presenceService.removePresence()
    }
}
