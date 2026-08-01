package com.shyden.shytalk.core.push

import kotlinx.coroutines.flow.MutableStateFlow
import kotlinx.coroutines.flow.StateFlow
import kotlinx.coroutines.flow.asStateFlow
import kotlinx.coroutines.flow.update

/**
 * A gift the recipient has just been sent, waiting to be shown in-app (SHY-0266).
 *
 * Carries WHO and WHAT. "You received a gift" does not make the gesture land —
 * the whole value of gifting to the sender is being seen, so the sender's name
 * and the gift's name are the payload, and nothing else is. No balances: this is
 * rendered on a screen that may be face-up on a table.
 */
data class GiftNotification(
    val senderId: String,
    val senderName: String,
    val giftName: String,
)

private val pendingGift = MutableStateFlow<GiftNotification?>(null)

/**
 * The latest gift to announce, or null.
 *
 * A NULLABLE StateFlow rather than a SharedFlow with replay, for the same reason
 * [chatDeepLinks] uses that shape: a re-subscription after sign-out or a
 * navigation-graph rebuild must NOT re-fire a stale event. Replaying here would
 * announce one user's gift to whoever signs in next on that device.
 */
val giftNotifications: StateFlow<GiftNotification?> = pendingGift.asStateFlow()

/**
 * Called by the platform push handler when a `type: "GIFT"` message arrives
 * while the app is in the FOREGROUND.
 *
 * Top-level so the auto-emitted Swift symbol is
 * `GiftNotificationBusKt.emitGiftNotification(...)`, matching the deep-link bus.
 *
 * A blank sender or gift name is DROPPED rather than shown. A banner reading
 * "sent you a" is worse than no banner: it tells the user something happened and
 * refuses to say what.
 */
fun emitGiftNotification(
    senderId: String,
    senderName: String,
    giftName: String,
) {
    if (senderName.isBlank() || giftName.isBlank()) return
    pendingGift.value = GiftNotification(senderId, senderName, giftName)
}

/** Called after the banner has been shown or dismissed. Idempotent. */
fun consumeGiftNotification() {
    pendingGift.update { null }
}

/**
 * Called on sign-out.
 *
 * Without this, a gift that arrived for the previous user is still pending when
 * the next one signs in on the same device, and is announced to them — leaking
 * who gifted whom.
 */
fun clearGiftNotifications() {
    pendingGift.value = null
}
