package com.shyden.shytalk.data.remote

/** Events pushed from the RoomDurableObject via WebSocket. */
sealed class RoomEvent {
    data object RoomUpdated : RoomEvent()
    data object NewMessage : RoomEvent()
    data object SeatRequestUpdated : RoomEvent()
    data object RoomClosed : RoomEvent()
    data class UserKicked(val userId: String) : RoomEvent()
}
