package com.shyden.shytalk.data.remote

import com.google.firebase.database.DataSnapshot
import io.mockk.every
import io.mockk.mockk
import okhttp3.OkHttpClient
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test

/**
 * Unit tests for RtdbPresenceService.
 *
 * Note: RTDB interactions (setValue, onDisconnect, addValueEventListener) are
 * Firebase SDK calls that require the Firebase emulator for integration testing.
 * These unit tests verify the service can be created and basic API contracts hold.
 * Full integration testing is done via E2E tests (connectedDebugAndroidTest).
 *
 * The snapshotIndicatesPresent helper IS unit-tested below — its DataSnapshot
 * arg is a plain interface that mockk can fully simulate, no emulator needed.
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

    // region snapshotIndicatesPresent — cron-elim A2 followup3 regression guards

    @Test
    fun `snapshotIndicatesPresent returns true for Boolean-valued node (Android-written presence)`() {
        // Android RtdbPresenceService.setPresence writes Boolean true at line 73:
        //   presenceRef.setValue(true)
        // This test pins that a Boolean-valued node is correctly recognised
        // as present — the Android-to-Android happy path.
        val snapshot = mockk<DataSnapshot>(relaxed = true)
        every { snapshot.exists() } returns true
        every { snapshot.getValue(Boolean::class.java) } returns true
        assertTrue(snapshotIndicatesPresent(snapshot))
    }

    @Test
    fun `snapshotIndicatesPresent returns true for Long-valued node (iOS-written presence) — cross-platform regression guard`() {
        // Cross-platform regression guard for the bug fixed in PR #1005:
        // iOS IosPresenceServiceImpl.setPresence writes a Long via
        //   ref.setValue(currentTimeMillis())
        // The pre-fix expression was
        //   snapshot.exists() && snapshot.getValue(Boolean::class.java) == true
        // which evaluated to false for a Long-valued node (getValue(Boolean)
        // returns null on a Long, null == true is false). The fix uses
        // snapshot.exists() alone — type-agnostic. This test would have
        // failed BEFORE the fix and now passes; a future refactor that
        // re-introduces the Boolean type check would fail this test.
        val snapshot = mockk<DataSnapshot>(relaxed = true)
        every { snapshot.exists() } returns true
        every { snapshot.getValue(Boolean::class.java) } returns null
        assertTrue(snapshotIndicatesPresent(snapshot))
    }

    @Test
    fun `snapshotIndicatesPresent returns false when node does not exist`() {
        // The "user is absent" path — RTDB removed the presence entry
        // (either via removePresence or via onDisconnect after a true
        // disconnect). snapshot.exists() = false → return false.
        val snapshot = mockk<DataSnapshot>(relaxed = true)
        every { snapshot.exists() } returns false
        assertFalse(snapshotIndicatesPresent(snapshot))
    }

    @Test
    fun `snapshotIndicatesPresent returns false for non-existent node even when Boolean would coerce to true`() {
        // Belt-and-braces: even if a non-existent node somehow returned
        // Boolean true on getValue (shouldn't happen but defend), exists()
        // being false is the gate. The helper is exists-only by design.
        val snapshot = mockk<DataSnapshot>(relaxed = true)
        every { snapshot.exists() } returns false
        every { snapshot.getValue(Boolean::class.java) } returns true
        assertFalse(snapshotIndicatesPresent(snapshot))
    }

    // endregion
}
