package com.shyden.shytalk.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class ConstantsTest {
    // ===== Seat constants =====

    @Test
    fun `MAX_SEATS is 8`() {
        assertEquals(8, Constants.MAX_SEATS)
    }

    @Test
    fun `OWNER_SEAT_INDEX is 0`() {
        assertEquals(0, Constants.OWNER_SEAT_INDEX)
    }

    @Test
    fun `OWNER_SEAT_INDEX is within valid seat range`() {
        assertTrue(Constants.OWNER_SEAT_INDEX in 0 until Constants.MAX_SEATS)
    }

    // ===== Timing constants =====

    @Test
    fun `ROOM_EXPIRY_COUNTDOWN_THRESHOLD_MS is 5 minutes`() {
        assertEquals(300_000L, Constants.ROOM_EXPIRY_COUNTDOWN_THRESHOLD_MS)
    }

    @Test
    fun `OWNER_LEAVE_TIMEOUT_MS is 5 minutes`() {
        assertEquals(300_000L, Constants.OWNER_LEAVE_TIMEOUT_MS)
    }

    @Test
    fun `MAX_ROOM_DURATION_MS is 6 hours`() {
        assertEquals(6 * 60 * 60 * 1000L, Constants.MAX_ROOM_DURATION_MS)
    }

    @Test
    fun `VOICE_DISCONNECT_GRACE_PERIOD_MS is 15 seconds`() {
        assertEquals(15_000L, Constants.VOICE_DISCONNECT_GRACE_PERIOD_MS)
    }

    @Test
    fun `PRESENCE_TIMEOUT_MS is 30 seconds`() {
        assertEquals(30_000L, Constants.PRESENCE_TIMEOUT_MS)
    }

    @Test
    fun `ONLINE_THRESHOLD_MS is 5 minutes`() {
        assertEquals(300_000L, Constants.ONLINE_THRESHOLD_MS)
    }

    // ===== Seat request timing =====

    @Test
    fun `SEAT_REQUEST_AUTO_DISMISS_MS is 3 seconds`() {
        assertEquals(3000L, Constants.SEAT_REQUEST_AUTO_DISMISS_MS)
    }

    @Test
    fun `SEAT_REQUEST_IMMEDIATE_THRESHOLD_MS is 5 seconds`() {
        assertEquals(5000L, Constants.SEAT_REQUEST_IMMEDIATE_THRESHOLD_MS)
    }

    // ===== Super Shy trial =====

    @Test
    fun `SUPER_SHY_TRIAL_ID is super_shy_trial`() {
        assertEquals("super_shy_trial", Constants.SUPER_SHY_TRIAL_ID)
    }

    // ===== System user =====

    @Test
    fun `SYSTEM_USER_ID is SHYTALK_SYSTEM`() {
        assertEquals("SHYTALK_SYSTEM", Constants.SYSTEM_USER_ID)
    }

    // ===== Chat and messaging constants =====

    @Test
    fun `MAX_ROOM_MESSAGES is 50`() {
        assertEquals(50, Constants.MAX_ROOM_MESSAGES)
    }

    @Test
    fun `MAX_PM_MESSAGE_LENGTH is 2000`() {
        assertEquals(2000, Constants.MAX_PM_MESSAGE_LENGTH)
    }

    @Test
    fun `PM_IMAGE_MAX_SIZE_BYTES is 5 MB`() {
        assertEquals(5 * 1024 * 1024L, Constants.PM_IMAGE_MAX_SIZE_BYTES)
    }

    @Test
    fun `PM_MAX_IMAGES_PER_MESSAGE is 10`() {
        assertEquals(10, Constants.PM_MAX_IMAGES_PER_MESSAGE)
    }

    @Test
    fun `PM_MESSAGES_PAGE_SIZE is 50`() {
        assertEquals(50, Constants.PM_MESSAGES_PAGE_SIZE)
    }

    // ===== Flood protection constants =====

    @Test
    fun `FLOOD_COOLDOWN_MS is 1 second`() {
        assertEquals(1_000L, Constants.FLOOD_COOLDOWN_MS)
    }

    @Test
    fun `FLOOD_WINDOW_MS is 10 seconds`() {
        assertEquals(10_000L, Constants.FLOOD_WINDOW_MS)
    }

    @Test
    fun `FLOOD_MAX_MESSAGES is 5`() {
        assertEquals(5, Constants.FLOOD_MAX_MESSAGES)
    }

    @Test
    fun `PM flood constants match room flood constants`() {
        assertEquals(Constants.FLOOD_COOLDOWN_MS, Constants.PM_FLOOD_COOLDOWN_MS)
        assertEquals(Constants.FLOOD_WINDOW_MS, Constants.PM_FLOOD_WINDOW_MS)
        assertEquals(Constants.FLOOD_MAX_MESSAGES, Constants.PM_FLOOD_MAX_MESSAGES)
    }

    // ===== PM edit and recall windows =====

    @Test
    fun `PM_EDIT_WINDOW_MS is 15 minutes`() {
        assertEquals(900_000L, Constants.PM_EDIT_WINDOW_MS)
    }

    @Test
    fun `PM_RECALL_WINDOW_MS is 5 minutes`() {
        assertEquals(300_000L, Constants.PM_RECALL_WINDOW_MS)
    }

    @Test
    fun `edit window is longer than recall window`() {
        assertTrue(Constants.PM_EDIT_WINDOW_MS > Constants.PM_RECALL_WINDOW_MS)
    }

    // ===== Group chat constants =====

    @Test
    fun `MAX_GROUP_PARTICIPANTS is 50`() {
        assertEquals(50, Constants.MAX_GROUP_PARTICIPANTS)
    }

    @Test
    fun `MAX_OWNED_GROUPS is 5`() {
        assertEquals(5, Constants.MAX_OWNED_GROUPS)
    }

    @Test
    fun `mute durations are in ascending order`() {
        assertTrue(Constants.MUTE_DURATION_5MIN < Constants.MUTE_DURATION_1HR)
        assertTrue(Constants.MUTE_DURATION_1HR < Constants.MUTE_DURATION_24HR)
    }

    // ===== Evidence constants =====

    @Test
    fun `EVIDENCE_VIDEO_TARGET_BYTES is less than EVIDENCE_MAX_SIZE_BYTES`() {
        assertTrue(Constants.EVIDENCE_VIDEO_TARGET_BYTES < Constants.EVIDENCE_MAX_SIZE_BYTES)
    }

    @Test
    fun `EVIDENCE_MAX_SIZE_BYTES is 20 MB`() {
        assertEquals(20 * 1024 * 1024L, Constants.EVIDENCE_MAX_SIZE_BYTES)
    }

    // ===== Stalker expiry =====

    @Test
    fun `STALKER_EXPIRY_MS is approximately 90 days`() {
        val ninetyDaysMs = 90L * 24 * 60 * 60 * 1000
        assertEquals(ninetyDaysMs, Constants.STALKER_EXPIRY_MS)
    }
}
