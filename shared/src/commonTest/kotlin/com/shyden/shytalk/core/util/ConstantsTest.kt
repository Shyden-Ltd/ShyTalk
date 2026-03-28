package com.shyden.shytalk.core.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

class ConstantsTest {
    // ── Room constants ──────────────────────────────────────────────

    @Test
    fun `MAX_SEATS is 8`() {
        assertEquals(8, Constants.MAX_SEATS)
    }

    @Test
    fun `OWNER_SEAT_INDEX is 0`() {
        assertEquals(0, Constants.OWNER_SEAT_INDEX)
    }

    @Test
    fun `OWNER_LEAVE_TIMEOUT_MS is 5 minutes`() {
        assertEquals(300_000L, Constants.OWNER_LEAVE_TIMEOUT_MS)
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
    fun `MAX_ROOM_DURATION_MS is 6 hours`() {
        assertEquals(6 * 60 * 60 * 1000L, Constants.MAX_ROOM_DURATION_MS)
    }

    @Test
    fun `ROOM_EXPIRY_COUNTDOWN_THRESHOLD_MS is 5 minutes`() {
        assertEquals(300_000L, Constants.ROOM_EXPIRY_COUNTDOWN_THRESHOLD_MS)
    }

    @Test
    fun `ACTIVE_ROOMS_QUERY_LIMIT is 100`() {
        assertEquals(100L, Constants.ACTIVE_ROOMS_QUERY_LIMIT)
    }

    // ── Seat request constants ──────────────────────────────────────

    @Test
    fun `SEAT_REQUEST_AUTO_DISMISS_MS is 3 seconds`() {
        assertEquals(3000L, Constants.SEAT_REQUEST_AUTO_DISMISS_MS)
    }

    @Test
    fun `SEAT_REQUEST_IMMEDIATE_THRESHOLD_MS is 5 seconds`() {
        assertEquals(5000L, Constants.SEAT_REQUEST_IMMEDIATE_THRESHOLD_MS)
    }

    // ── Online status ───────────────────────────────────────────────

    @Test
    fun `ONLINE_THRESHOLD_MS is 5 minutes`() {
        assertEquals(300_000L, Constants.ONLINE_THRESHOLD_MS)
    }

    // ── Chat messages ───────────────────────────────────────────────

    @Test
    fun `MAX_ROOM_MESSAGES is 50`() {
        assertEquals(50, Constants.MAX_ROOM_MESSAGES)
    }

    // ── Message flood protection ────────────────────────────────────

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

    // ── Stalker expiry ──────────────────────────────────────────────

    @Test
    fun `STALKER_EXPIRY_MS is approximately 3 months`() {
        val threeMonthsMs = 90L * 24 * 60 * 60 * 1000
        assertEquals(threeMonthsMs, Constants.STALKER_EXPIRY_MS)
    }

    // ── Private messaging ───────────────────────────────────────────

    @Test
    fun `MAX_PM_MESSAGE_LENGTH is 2000`() {
        assertEquals(2000, Constants.MAX_PM_MESSAGE_LENGTH)
    }

    @Test
    fun `PM_IMAGE_MAX_SIZE_BYTES is 5MB`() {
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

    @Test
    fun `PM_EDIT_WINDOW_MS is 15 minutes`() {
        assertEquals(900_000L, Constants.PM_EDIT_WINDOW_MS)
    }

    @Test
    fun `PM_RECALL_WINDOW_MS is 5 minutes`() {
        assertEquals(300_000L, Constants.PM_RECALL_WINDOW_MS)
    }

    @Test
    fun `TYPING_DEBOUNCE_MS is 5 seconds`() {
        assertEquals(5_000L, Constants.TYPING_DEBOUNCE_MS)
    }

    // ── PM flood protection ─────────────────────────────────────────

    @Test
    fun `PM_FLOOD_COOLDOWN_MS is 1 second`() {
        assertEquals(1_000L, Constants.PM_FLOOD_COOLDOWN_MS)
    }

    @Test
    fun `PM_FLOOD_WINDOW_MS is 10 seconds`() {
        assertEquals(10_000L, Constants.PM_FLOOD_WINDOW_MS)
    }

    @Test
    fun `PM_FLOOD_MAX_MESSAGES is 5`() {
        assertEquals(5, Constants.PM_FLOOD_MAX_MESSAGES)
    }

    // ── Group chats ─────────────────────────────────────────────────

    @Test
    fun `MAX_GROUP_PARTICIPANTS is 50`() {
        assertEquals(50, Constants.MAX_GROUP_PARTICIPANTS)
    }

    @Test
    fun `MAX_OWNED_GROUPS is 5`() {
        assertEquals(5, Constants.MAX_OWNED_GROUPS)
    }

    @Test
    fun `MAX_GROUP_DESCRIPTION_LENGTH is 1000`() {
        assertEquals(1000, Constants.MAX_GROUP_DESCRIPTION_LENGTH)
    }

    @Test
    fun `MUTE_DURATION_5MIN is 5 minutes in millis`() {
        assertEquals(5 * 60 * 1000L, Constants.MUTE_DURATION_5MIN)
    }

    @Test
    fun `MUTE_DURATION_1HR is 1 hour in millis`() {
        assertEquals(60 * 60 * 1000L, Constants.MUTE_DURATION_1HR)
    }

    @Test
    fun `MUTE_DURATION_24HR is 24 hours in millis`() {
        assertEquals(24 * 60 * 60 * 1000L, Constants.MUTE_DURATION_24HR)
    }

    // ── Report evidence ─────────────────────────────────────────────

    @Test
    fun `EVIDENCE_MAX_SIZE_BYTES is 20MB`() {
        assertEquals(20 * 1024 * 1024L, Constants.EVIDENCE_MAX_SIZE_BYTES)
    }

    @Test
    fun `EVIDENCE_VIDEO_TARGET_BYTES is 18MB`() {
        assertEquals(18 * 1024 * 1024L, Constants.EVIDENCE_VIDEO_TARGET_BYTES)
    }

    @Test
    fun `evidence video target is less than max size`() {
        assertTrue(Constants.EVIDENCE_VIDEO_TARGET_BYTES < Constants.EVIDENCE_MAX_SIZE_BYTES)
    }

    // ── System user ─────────────────────────────────────────────────

    @Test
    fun `SYSTEM_USER_ID is SHYTALK_SYSTEM`() {
        assertEquals("SHYTALK_SYSTEM", Constants.SYSTEM_USER_ID)
    }

    @Test
    fun `SUPER_SHY_TRIAL_ID is super_shy_trial`() {
        assertEquals("super_shy_trial", Constants.SUPER_SHY_TRIAL_ID)
    }

    // ── Legal URLs ──────────────────────────────────────────────────

    @Test
    fun `LEGAL_BASE_URL starts with https`() {
        assertTrue(Constants.LEGAL_BASE_URL.startsWith("https://"))
    }

    @Test
    fun `PRIVACY_POLICY_URL contains legal base URL`() {
        assertTrue(Constants.PRIVACY_POLICY_URL.startsWith(Constants.LEGAL_BASE_URL))
    }

    @Test
    fun `TERMS_URL contains legal base URL`() {
        assertTrue(Constants.TERMS_URL.startsWith(Constants.LEGAL_BASE_URL))
    }

    @Test
    fun `COMMUNITY_GUIDELINES_URL contains legal base URL`() {
        assertTrue(Constants.COMMUNITY_GUIDELINES_URL.startsWith(Constants.LEGAL_BASE_URL))
    }

    @Test
    fun `CYBER_BULLYING_URL contains legal base URL`() {
        assertTrue(Constants.CYBER_BULLYING_URL.startsWith(Constants.LEGAL_BASE_URL))
    }

    @Test
    fun `all legal URLs end with html extension`() {
        assertTrue(Constants.PRIVACY_POLICY_URL.endsWith(".html"))
        assertTrue(Constants.TERMS_URL.endsWith(".html"))
        assertTrue(Constants.COMMUNITY_GUIDELINES_URL.endsWith(".html"))
        assertTrue(Constants.CYBER_BULLYING_URL.endsWith(".html"))
    }

    // ── Notification channels ───────────────────────────────────────

    @Test
    fun `ROOM_NOTIFICATION_CHANNEL_ID is not empty`() {
        assertTrue(Constants.ROOM_NOTIFICATION_CHANNEL_ID.isNotEmpty())
    }

    @Test
    fun `PM_NOTIFICATION_CHANNEL_ID is not empty`() {
        assertTrue(Constants.PM_NOTIFICATION_CHANNEL_ID.isNotEmpty())
    }

    @Test
    fun `notification channel IDs are distinct`() {
        assertTrue(
            Constants.ROOM_NOTIFICATION_CHANNEL_ID != Constants.PM_NOTIFICATION_CHANNEL_ID,
            "Room and PM notification channels must be different",
        )
    }
}
