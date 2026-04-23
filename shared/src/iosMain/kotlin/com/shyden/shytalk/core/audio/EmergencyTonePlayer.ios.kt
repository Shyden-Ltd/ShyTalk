@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package com.shyden.shytalk.core.audio

import com.shyden.shytalk.core.util.logW
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.get
import kotlinx.cinterop.set
import platform.AVFAudio.AVAudioEngine
import platform.AVFAudio.AVAudioFormat
import platform.AVFAudio.AVAudioPCMBuffer
import platform.AVFAudio.AVAudioPlayerNode
import platform.AVFAudio.AVAudioSession
import platform.AVFAudio.AVAudioSessionCategoryPlayback
import platform.AVFAudio.setActive
import kotlin.math.PI
import kotlin.math.sin

actual object EmergencyTonePlayer {
    private const val SAMPLE_RATE = 44100.0
    private const val AMPLITUDE = 0.30f
    private const val ATTN_FREQ_1 = 853.0
    private const val ATTN_FREQ_2 = 960.0
    private const val ATTN_DURATION = 8.0

    private var engine: AVAudioEngine? = null
    private var playerNode: AVAudioPlayerNode? = null

    actual fun play() {
        stop()
        try {
            val session = AVAudioSession.sharedInstance()
            session.setCategory(AVAudioSessionCategoryPlayback, error = null)
            session.setActive(true, error = null)

            val audioEngine = AVAudioEngine()
            val player = AVAudioPlayerNode()
            audioEngine.attachNode(player)

            val format =
                AVAudioFormat(
                    standardFormatWithSampleRate = SAMPLE_RATE,
                    channels = 1u,
                ) ?: return

            audioEngine.connect(player, to = audioEngine.mainMixerNode, format = format)

            val signal = generateAttentionTone()
            val buffer =
                AVAudioPCMBuffer(
                    pCMFormat = format,
                    frameCapacity = signal.size.toUInt(),
                ) ?: return
            buffer.frameLength = signal.size.toUInt()

            val channelData = buffer.floatChannelData ?: return
            val channel = channelData[0] ?: return
            for (i in signal.indices) {
                channel[i] = signal[i]
            }

            if (!audioEngine.startAndReturnError(null)) {
                logW("EmergencyTonePlayer", "AVAudioEngine failed to start")
                return
            }
            player.scheduleBuffer(buffer, completionHandler = null)
            player.play()

            engine = audioEngine
            playerNode = player
        } catch (e: Exception) {
            logW("EmergencyTonePlayer", "Failed to play EAS tone: ${e.message}")
        }
    }

    actual fun stop() {
        try {
            playerNode?.stop()
            engine?.stop()
            AVAudioSession.sharedInstance().setActive(false, error = null)
        } catch (e: Exception) {
            logW("EmergencyTonePlayer", "Failed to stop audio: ${e.message}")
        }
        playerNode = null
        engine = null
    }

    private fun generateAttentionTone(): FloatArray {
        val numSamples = (SAMPLE_RATE * ATTN_DURATION).toInt()
        val buffer = FloatArray(numSamples)
        for (i in 0 until numSamples) {
            val t = i / SAMPLE_RATE
            val v = (sin(2 * PI * ATTN_FREQ_1 * t) + sin(2 * PI * ATTN_FREQ_2 * t)) * 0.5 * AMPLITUDE
            buffer[i] = v.toFloat()
        }
        return buffer
    }
}
