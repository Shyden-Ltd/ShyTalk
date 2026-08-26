package com.shyden.shytalk.feature.room

/**
 * What the room screen shows.
 *
 * SHY-0466. This exists so that "voice never decides whether the room
 * renders" is something a test can assert, rather than something read off a
 * screenshot. The room screen used to carry a branch —
 *
 *     } else if (uiState.hasJoined && !uiState.isVoiceReady) {
 *
 * — that withheld the seat grid, the chat and the participant list until
 * voice reported ready. Nothing on that list needs voice, and no path marked
 * voice ready on failure: only a ten-second watchdog. So on any network that
 * blocks media, every room open cost ten seconds of blank screen.
 *
 * Note what is NOT a member of this type: any voice state. The gates that
 * remain are about the room itself and about whether this person may see it.
 */
enum class RoomScreenContent {
    /** The room has closed and there is a summary to show for it. */
    CLOSED_SUMMARY,

    /** The room is closing and the summary has not arrived yet. */
    CLOSING,

    /** The room's own data is still loading. */
    LOADING,

    /** The block check has not finished. Nothing of the room may be shown yet. */
    CHECKING_ACCESS,

    /** The block check finished and refused. */
    BLOCK_WARNING,

    /** The room. */
    ROOM,
}

/**
 * Decides what the room screen shows, from room state alone.
 *
 * Order matters and mirrors the screen: closure wins over loading, loading
 * over the access check, and the access check over the room — because
 * rendering a room the block check has not cleared is a safeguarding failure,
 * not a cosmetic one.
 */
fun roomScreenContentFor(state: RoomUiState): RoomScreenContent =
    when {
        state.roomClosed && state.roomClosedSummary != null -> RoomScreenContent.CLOSED_SUMMARY
        state.roomClosed -> RoomScreenContent.CLOSING
        state.isLoading -> RoomScreenContent.LOADING
        !state.hasJoined && state.blockWarning == null -> RoomScreenContent.CHECKING_ACCESS
        !state.hasJoined -> RoomScreenContent.BLOCK_WARNING
        else -> RoomScreenContent.ROOM
    }
