package com.shyden.shytalk.core.audio

/**
 * Plays an EAS (Emergency Alert System) signal for the WarningScreen.
 *
 * Platform implementations:
 * - Android: AudioTrack with PCM 16-bit mono
 * - iOS: AVAudioEngine with AVAudioPCMBuffer
 */
expect object EmergencyTonePlayer {
    fun play()

    fun stop()
}
