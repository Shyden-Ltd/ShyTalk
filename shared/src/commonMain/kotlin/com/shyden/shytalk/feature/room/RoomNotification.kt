package com.shyden.shytalk.feature.room

import com.shyden.shytalk.core.model.SeatRequest

sealed class RoomNotification {
    abstract val id: String

    /** Shown to owner/hosts when someone requests a seat. Auto-dismisses after 3s. */
    data class SeatRequestReceived(
        val request: SeatRequest,
    ) : RoomNotification() {
        override val id: String get() = "seat-request-${request.requestId}"
    }

    /** Shown to requester when their request is approved after >5s. Persistent. */
    data class RequestApproved(
        val request: SeatRequest,
    ) : RoomNotification() {
        override val id: String get() = "approved-${request.requestId}"
    }

    /** Shown to invited user. Persistent. */
    data class InviteReceived(
        val inviterUserId: String,
    ) : RoomNotification() {
        override val id: String get() = "invite-$inviterUserId"
    }
}
