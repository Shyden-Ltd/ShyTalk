package com.shyden.shytalk.core.ui

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertTrue

/**
 * Lock the user-visible reason list. Both DM (PrivateChatScreen) and room
 * (RoomScreen) surfaces pull from this constant, so a drift here changes
 * both products' reporting taxonomy AND silently changes what the
 * `reason` field carries on the wire to `POST /api/reports`.
 *
 * The admin moderation UI clusters reports by reason string for triage —
 * adding a reason that the admin tab doesn't know about means those
 * reports show up in "Other" rather than their own filter bucket. Pin
 * the contents + order so future additions are a conscious, cross-cutting
 * change.
 */
class ReportMessageDialogTest {
    @Test
    fun `reason list has exactly four entries in the canonical order`() {
        assertEquals(
            listOf("Spam", "Harassment", "Inappropriate Content", "Other"),
            reportMessageReasons,
        )
    }

    @Test
    fun `all entries are non-blank`() {
        // Defence against a stray empty string sneaking in via a translation
        // refactor — the on-wire `reason` becomes "" which the admin filter
        // treats as missing and the moderation queue loses the row.
        for (reason in reportMessageReasons) {
            assertTrue(reason.isNotBlank(), "Reason must be non-blank: '$reason'")
        }
    }

    @Test
    fun `Other is the last entry by convention`() {
        // The "fallback" reason is always last in the radio list so it's not
        // the default selection. A reorder that bubbled "Other" to the top
        // would silently change which reason gets pre-selected, biasing
        // every report whose author didn't explicitly tap a radio.
        assertEquals("Other", reportMessageReasons.last())
    }
}
