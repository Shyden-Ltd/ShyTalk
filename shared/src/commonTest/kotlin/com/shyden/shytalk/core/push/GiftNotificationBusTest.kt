package com.shyden.shytalk.core.push

import kotlin.test.AfterTest
import kotlin.test.BeforeTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * SHY-0266 — the in-app gift bus.
 *
 * j05 asserts the recipient sees an in-app notification naming the sender and
 * the gift. There was no such surface, so the step failed every run and blamed
 * the app.
 */
class GiftNotificationBusTest {
    @BeforeTest
    fun reset() {
        clearGiftNotifications()
    }

    @AfterTest
    fun cleanUp() {
        clearGiftNotifications()
    }

    @Test
    fun `an emitted gift carries who and what`() {
        emitGiftNotification("50000010", "Alice", "crown")
        val pending = giftNotifications.value
        assertEquals("Alice", pending?.senderName)
        assertEquals("crown", pending?.giftName)
        assertEquals("50000010", pending?.senderId)
    }

    @Test
    fun `consuming clears it, and consuming twice is safe`() {
        emitGiftNotification("1", "Alice", "crown")
        consumeGiftNotification()
        assertNull(giftNotifications.value)
        consumeGiftNotification()
        assertNull(giftNotifications.value)
    }

    @Test
    fun `a blank sender name is dropped, not shown`() {
        // A banner reading "sent you a crown" with nobody attached is worse than
        // no banner: it says something happened and refuses to say who did it.
        emitGiftNotification("1", "", "crown")
        assertNull(giftNotifications.value)
        emitGiftNotification("1", "   ", "crown")
        assertNull(giftNotifications.value)
    }

    @Test
    fun `a blank gift name is dropped, not shown`() {
        emitGiftNotification("1", "Alice", "")
        assertNull(giftNotifications.value)
    }

    @Test
    fun `sign-out clears a pending gift`() {
        // Without this, a gift that arrived for the previous user is still
        // pending when the next signs in on the same device and is announced to
        // them — leaking who gifted whom.
        emitGiftNotification("1", "Alice", "crown")
        clearGiftNotifications()
        assertNull(giftNotifications.value)
    }

    @Test
    fun `a second gift replaces the first rather than being lost silently`() {
        // Two gifts in quick succession: the newest is what the banner shows.
        // The alternative — dropping the second because one is pending — would
        // lose a real event, and the sender paid for it.
        emitGiftNotification("1", "Alice", "crown")
        emitGiftNotification("2", "Bea", "rose")
        assertEquals("Bea", giftNotifications.value?.senderName)
        assertEquals("rose", giftNotifications.value?.giftName)
    }
}
