package com.shyden.shytalk.feature.room.components

import com.shyden.shytalk.core.model.MessageType

/**
 * Decide whether a room message exposes the "report" long-press affordance.
 *
 * Pure function so the policy (UK OSA B3 — non-self TEXT messages from real
 * users) is testable without spinning up Compose. ChatPanel uses this to gate
 * the `onReportMessage` callback that MessageBubble's combinedClickable hooks
 * into. Server-side never blocks based on these — defence is admin-side — so
 * the gate exists purely for UX hygiene (don't show "report" on your own
 * messages, on JOIN/GIFT events, or on system announcements).
 */
internal fun isRoomMessageReportable(
    isSelf: Boolean,
    type: MessageType,
    senderId: String,
): Boolean = !isSelf && type == MessageType.TEXT && senderId != "system"
