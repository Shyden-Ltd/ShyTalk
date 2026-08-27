package com.shyden.shytalk.feature.room

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * SHY-0466 — a room must open even when voice cannot.
 *
 * The room screen used to render nothing until voice reported ready:
 *
 *     } else if (uiState.hasJoined && !uiState.isVoiceReady) {
 *         // Loading screen while connecting to voice
 *
 * and no path marked voice ready on failure — only a 10s watchdog. So on any
 * network where media is blocked, the seat grid, the chat and the participant
 * list were all withheld for ten seconds. None of them need voice.
 *
 * Measured on a real phone (2026-08-26): with voice unreachable the seat grid
 * did not appear within 10 000 ms; with voice reachable it appeared in 2.2 s.
 * The ten seconds were the watchdog, not the room.
 *
 * The decision is a pure function so "voice never decides whether the room
 * renders" is an assertion rather than something read off a screenshot.
 */
class RoomScreenContentTest {
    // A state that has cleared every gate ahead of voice: not closed, done
    // loading, joined. This is the room the person came for.
    private fun joined(
        voiceReason: VoiceUnavailableReason? = null,
        isVoiceReady: Boolean = false,
    ) = RoomUiState(
        isLoading = false,
        hasJoined = true,
        isVoiceReady = isVoiceReady,
        voiceUnavailableReason = voiceReason,
    )

    @Test
    fun `the room renders while voice is still connecting`() {
        // The defect, stated directly. Voice not ready, nothing wrong yet —
        // and the room is what must be on screen.
        assertEquals(RoomScreenContent.ROOM, roomScreenContentFor(joined()))
    }

    @Test
    fun `the room renders when voice has given up`() {
        assertEquals(
            RoomScreenContent.ROOM,
            roomScreenContentFor(joined(voiceReason = VoiceUnavailableReason.CONNECT_TIMED_OUT)),
        )
    }

    @Test
    fun `the room renders when the voice service reported an error`() {
        assertEquals(
            RoomScreenContent.ROOM,
            roomScreenContentFor(joined(voiceReason = VoiceUnavailableReason.SERVICE_ERROR)),
        )
    }

    @Test
    fun `no voice state changes what the room screen shows`() {
        // Exhaustive over the voice states rather than a sample of them: a
        // reason added later must not be able to re-block the room.
        val everyVoiceState =
            buildList {
                add(joined())
                add(joined(isVoiceReady = true))
                VoiceUnavailableReason.entries.forEach { reason ->
                    add(joined(voiceReason = reason))
                    add(joined(voiceReason = reason, isVoiceReady = true))
                }
            }
        assertTrue(everyVoiceState.size >= 4, "the sweep must actually cover several states")
        everyVoiceState.forEach { state ->
            assertEquals(
                RoomScreenContent.ROOM,
                roomScreenContentFor(state),
                "voice state must not decide the room's content",
            )
        }
    }

    // ===== the gates AHEAD of voice must keep their precedence =====

    @Test
    fun `a closed room with a summary shows the summary`() {
        val state =
            joined().copy(
                roomClosed = true,
                roomClosedSummary =
                    RoomClosedSummary(
                        roomName = "JR-CORE",
                        durationMs = 0L,
                        hostUsers = emptyList(),
                        speakerUsers = emptyList(),
                        ownerId = "50000060",
                        totalVisitors = 0,
                    ),
            )
        assertEquals(RoomScreenContent.CLOSED_SUMMARY, roomScreenContentFor(state))
    }

    @Test
    fun `a closed room without a summary shows closing`() {
        assertEquals(
            RoomScreenContent.CLOSING,
            roomScreenContentFor(joined().copy(roomClosed = true)),
        )
    }

    @Test
    fun `a loading room shows loading, ahead of everything but closure`() {
        assertEquals(
            RoomScreenContent.LOADING,
            roomScreenContentFor(joined().copy(isLoading = true)),
        )
    }

    @Test
    fun `an unfinished access check shows the check, not the room`() {
        // Rendering earlier must NOT render a room the block check has not
        // cleared. This is the security boundary the change must not cross.
        val state = joined().copy(hasJoined = false, blockWarning = null)
        assertEquals(RoomScreenContent.CHECKING_ACCESS, roomScreenContentFor(state))
    }

    @Test
    fun `a block warning is not the room either`() {
        val state = joined().copy(hasJoined = false, blockWarning = BlockWarning.BlockedByRoomOwner)
        assertEquals(RoomScreenContent.BLOCK_WARNING, roomScreenContentFor(state))
    }
}
