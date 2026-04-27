package com.shyden.shytalk.core.room

import com.shyden.shytalk.core.util.logI

/**
 * iOS no-op implementation of RoomServiceController.
 *
 * Android uses a foreground notification service to keep the room connection
 * alive when the app is backgrounded. iOS achieves the equivalent via
 * AVAudioSession's background audio mode (configured in Info.plist) plus
 * LiveKit's iOS SDK keeping its WebRTC connection alive. No service to
 * start/stop here — the OS audio session handles backgrounding directly.
 */
class IosRoomServiceController : RoomServiceController {
    override fun start(roomId: String) {
        logI("RoomServiceController", "start(roomId=$roomId) — iOS no-op (audio session handles backgrounding)")
    }

    override fun stop() {
        logI("RoomServiceController", "stop() — iOS no-op")
    }
}
