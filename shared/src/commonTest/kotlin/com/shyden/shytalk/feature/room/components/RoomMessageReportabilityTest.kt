package com.shyden.shytalk.feature.room.components

import com.shyden.shytalk.core.model.MessageType
import kotlin.test.Test
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Pins the B3 (UK OSA per-message reporting) UI gate. The 4 boolean predicates
 * combine into 16 truth-table rows; this covers the happy path plus each
 * predicate flipped independently so a future regression that drops one of
 * the gates (e.g. accidentally allowing self-message reports) fails loudly.
 */
class RoomMessageReportabilityTest {
    @Test
    fun `happy path - non-self TEXT message from a real user is reportable`() {
        assertTrue(isRoomMessageReportable(isSelf = false, type = MessageType.TEXT, senderId = "user-1"))
    }

    @Test
    fun `self-flip - self TEXT message is NOT reportable`() {
        assertFalse(isRoomMessageReportable(isSelf = true, type = MessageType.TEXT, senderId = "user-1"))
    }

    @Test
    fun `type-flip SYSTEM - non-self SYSTEM message is NOT reportable`() {
        assertFalse(isRoomMessageReportable(isSelf = false, type = MessageType.SYSTEM, senderId = "user-1"))
    }

    @Test
    fun `type-flip JOIN - non-self JOIN message is NOT reportable`() {
        assertFalse(isRoomMessageReportable(isSelf = false, type = MessageType.JOIN, senderId = "user-1"))
    }

    @Test
    fun `type-flip GIFT - non-self GIFT message is NOT reportable`() {
        assertFalse(isRoomMessageReportable(isSelf = false, type = MessageType.GIFT, senderId = "user-1"))
    }

    @Test
    fun `sender-flip - system-sender TEXT message is NOT reportable even though type is TEXT`() {
        // System announcements sometimes ship as TEXT with senderId="system" (admin
        // broadcasts, room close warnings). The gate must catch this — otherwise
        // a regular user could "report" a system message, which the server treats
        // as a self-inflicted infraction since there is no real reportee.
        assertFalse(isRoomMessageReportable(isSelf = false, type = MessageType.TEXT, senderId = "system"))
    }

    @Test
    fun `compound - self AND system-type AND system-sender is NOT reportable`() {
        // Multiple disqualifying conditions still produce false; no exotic AND/OR
        // bug that would let one predicate accidentally override the others.
        assertFalse(isRoomMessageReportable(isSelf = true, type = MessageType.SYSTEM, senderId = "system"))
    }

    @Test
    fun `empty senderId - empty string is reportable per current policy`() {
        // Lock the current behaviour: empty senderId passes the != "system" check
        // and the gate evaluates true. If a future fix decides empty IDs should
        // be filtered out, this test will fail loudly and force the policy change
        // to be a conscious update (not a silent regression).
        assertTrue(isRoomMessageReportable(isSelf = false, type = MessageType.TEXT, senderId = ""))
    }
}
