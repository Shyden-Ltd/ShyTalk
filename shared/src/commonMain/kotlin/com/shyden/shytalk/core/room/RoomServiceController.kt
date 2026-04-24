package com.shyden.shytalk.core.room

/**
 * Platform-specific controller for the foreground room service.
 *
 * On Android: starts/stops the foreground notification service (RoomService).
 * On iOS: no-op (iOS handles background audio via AVAudioSession, not foreground services).
 */
interface RoomServiceController {
    fun start(roomId: String)

    fun stop()
}
