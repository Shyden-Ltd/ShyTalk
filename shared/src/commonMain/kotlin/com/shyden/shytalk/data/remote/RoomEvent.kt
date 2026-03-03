package com.shyden.shytalk.data.remote

/** Room events observed via Firebase RTDB listeners. */
sealed class RoomEvent {
    data object RoomUpdated : RoomEvent()
    data object NewMessage : RoomEvent()
    data object SeatRequestUpdated : RoomEvent()
    data object RoomClosed : RoomEvent()
    data class UserKicked(val userId: String) : RoomEvent()
}
