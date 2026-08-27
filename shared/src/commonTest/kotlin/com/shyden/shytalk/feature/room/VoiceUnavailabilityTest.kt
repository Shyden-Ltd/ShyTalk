package com.shyden.shytalk.feature.room

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

/**
 * SHY-0466 — an unavailable voice must say WHY.
 *
 * Four sites set `isVoiceUnavailable = true`; only one recorded a reason. The
 * other three were the watchdog, so the banner could only ever produce the
 * generic "Voice chat is temporarily unavailable" — a string that names
 * neither the layer nor the cause, and the string a whole session of
 * diagnosis started from.
 */
class VoiceUnavailabilityTest {
    @Test
    fun `voice is unavailable exactly when a reason says so`() {
        // Derived, not stored: there is no way to be unavailable-without-reason
        // to construct, which is the point.
        assertFalse(RoomUiState().isVoiceUnavailable)
        assertNull(RoomUiState().voiceUnavailableReason)
        VoiceUnavailableReason.entries.forEach { reason ->
            val state = RoomUiState(voiceUnavailableReason = reason)
            assertTrue(state.isVoiceUnavailable, "$reason must read as unavailable")
            assertEquals(reason, state.voiceUnavailableReason)
        }
    }

    @Test
    fun `every reason is distinguishable, so the banner can differ`() {
        assertEquals(
            VoiceUnavailableReason.entries.size,
            VoiceUnavailableReason.entries.toSet().size,
        )
        assertTrue(VoiceUnavailableReason.entries.size >= 2)
    }
}
