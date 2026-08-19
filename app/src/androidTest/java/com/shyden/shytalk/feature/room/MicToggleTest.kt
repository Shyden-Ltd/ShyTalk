package com.shyden.shytalk.feature.room

import androidx.compose.material3.MaterialTheme
import androidx.compose.ui.test.assertCountEquals
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertIsEnabled
import androidx.compose.ui.test.assertIsNotEnabled
import androidx.compose.ui.test.junit4.v2.createComposeRule
import androidx.compose.ui.test.onAllNodesWithTag
import androidx.compose.ui.test.onNodeWithContentDescription
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.performClick
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.shyden.shytalk.core.model.RoomRole
import com.shyden.shytalk.core.model.Seat
import com.shyden.shytalk.core.model.SeatState
import com.shyden.shytalk.feature.room.components.ChatPanel
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/**
 * SHY-0272 — the mic toggle in a voice room. Reported from a real device as
 * "the mic is stuck open and cannot be muted/unmuted".
 *
 * Two independent defects had to line up, and NEITHER had a test:
 *
 *  1. `RoomScreen` gated the toggle on `hasPermission("microphone")`, a string
 *     the Android implementation handed straight to
 *     `ContextCompat.checkSelfPermission`, which only knows
 *     `android.permission.*` constants. Always DENIED, so the `if` swallowed
 *     every tap — no request, no error, no feedback.
 *  2. The server routed SELF-mute through the FORCE-mute moderator gate, which
 *     refuses every caller acting on their own seat, in every role.
 *
 * So even after the tap reached the API it would have been refused. This file
 * covers the control itself: that it is present when it should be, says what
 * it should say, is disabled only when voice is genuinely unavailable, and
 * actually invokes its callback with the right seat.
 *
 * A `testTag` assertion would have passed throughout the entire outage — the
 * button was always there. Only invoking it, and reading its label, catches
 * this.
 */
@RunWith(AndroidJUnit4::class)
class MicToggleTest {
    @get:Rule
    val composeTestRule = createComposeRule()

    private val me = "50000030"

    private fun seats(
        muted: Boolean = false,
        seatIndex: String = "2",
    ) = mapOf(seatIndex to Seat(userId = me, state = SeatState.OCCUPIED, isMuted = muted))

    /** Renders the panel; `taps` records every seat index the toggle reports. */
    private fun renderPanel(
        seats: Map<String, Seat>,
        voiceUnavailable: Boolean = false,
        taps: MutableList<Int> = mutableListOf(),
    ): MutableList<Int> {
        composeTestRule.setContent {
            MaterialTheme {
                ChatPanel(
                    messages = emptyList(),
                    currentUserId = me,
                    currentRole = RoomRole.OWNER,
                    seats = seats,
                    userMap = emptyMap(),
                    isVoiceUnavailable = voiceUnavailable,
                    onToggleMic = { taps += it },
                    onSendMessage = {},
                    onTapUser = {},
                    onInviteUser = { _, _ -> },
                )
            }
        }
        return taps
    }

    @Test
    fun tappingTheMicToggleReportsTheOccupiedSeat() {
        // The heart of the bug: the tap must actually reach the callback. For
        // the whole outage it never did, and nothing noticed because the
        // button was still on screen and still clickable.
        val taps = renderPanel(seats(muted = false, seatIndex = "2"))
        composeTestRule.onNodeWithTag("room_micToggleButton").performClick()
        composeTestRule.waitForIdle()
        assertEquals(listOf(2), taps)
    }

    @Test
    fun theToggleReadsMuteWhenLiveAndUnmuteWhenMuted() {
        // The label is the only thing that tells a user which way the control
        // will go. Asserting the tag proves nothing about that.
        renderPanel(seats(muted = false))
        composeTestRule.onNodeWithContentDescription("Mute").assertIsDisplayed()

        composeTestRule.onNodeWithTag("room_micToggleButton").assertIsEnabled()
    }

    @Test
    fun theToggleReadsUnmuteWhenTheSeatIsMuted() {
        renderPanel(seats(muted = true))
        composeTestRule.onNodeWithContentDescription("Unmute").assertIsDisplayed()
    }

    @Test
    fun theToggleIsDisabledAndSilentWhenVoiceIsUnavailable() {
        // Disabled here is CORRECT — there is no voice session to mute. This
        // pins that the disabled state is reserved for that genuine case, so a
        // future regression cannot quietly disable the control for everyone
        // (which is, in effect, what the permission bug did).
        val taps = renderPanel(seats(muted = false), voiceUnavailable = true)
        composeTestRule.onNodeWithContentDescription("Voice unavailable").assertIsDisplayed()
        composeTestRule.onNodeWithTag("room_micToggleButton").assertIsNotEnabled()
        composeTestRule.onNodeWithTag("room_micToggleButton").performClick()
        composeTestRule.waitForIdle()
        assertEquals(emptyList<Int>(), taps)
    }

    @Test
    fun thereIsNoMicToggleWhenNotSeated() {
        // Someone in the room but not on a seat has no microphone to mute.
        val taps = renderPanel(mapOf("2" to Seat(userId = "99999", state = SeatState.OCCUPIED)))
        composeTestRule.onAllNodesWithTag("room_micToggleButton").assertCountEquals(0)
        assertEquals(emptyList<Int>(), taps)
    }

    @Test
    fun theToggleReportsTheSeatItIsActuallyIn() {
        // Guards against reporting a hard-coded or off-by-one seat: the server
        // writes `seats.{index}.isMuted`, so a wrong index would mute someone
        // else — or silently 403.
        val taps = renderPanel(seats(muted = false, seatIndex = "7"))
        composeTestRule.onNodeWithTag("room_micToggleButton").performClick()
        composeTestRule.waitForIdle()
        assertEquals(listOf(7), taps)
    }
}
