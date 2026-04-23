package com.shyden.shytalk.core.audio

actual object EmergencyTonePlayer {
    actual fun play() {
        // No-op on JVM (test-only target)
    }

    actual fun stop() {
        // No-op on JVM (test-only target)
    }
}
