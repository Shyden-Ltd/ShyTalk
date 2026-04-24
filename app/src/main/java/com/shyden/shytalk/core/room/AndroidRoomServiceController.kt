package com.shyden.shytalk.core.room

import android.content.Context

class AndroidRoomServiceController(
    private val context: Context,
) : RoomServiceController {
    override fun start(roomId: String) {
        RoomService.start(context, roomId)
    }

    override fun stop() {
        RoomService.stop(context)
    }
}
