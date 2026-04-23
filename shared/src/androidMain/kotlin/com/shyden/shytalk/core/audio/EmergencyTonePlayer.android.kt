package com.shyden.shytalk.core.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import com.shyden.shytalk.core.util.logW
import kotlin.math.PI
import kotlin.math.sin

/**
 * Plays an authentic Emergency Alert System (EAS) signal:
 *
 * 1. Three SAME (Specific Area Message Encoding) data bursts
 *    — FSK at 520.83 baud between mark (2083.3 Hz) and space (1562.5 Hz)
 *    — separated by 1-second pauses
 * 2. Followed by the 8-second attention tone (853 Hz + 960 Hz dual sine)
 */
actual object EmergencyTonePlayer {
    private const val SAMPLE_RATE = 44100
    private const val AMPLITUDE = 0.30f

    // SAME FSK parameters
    private const val MARK_FREQ = 2083.3 // logical 1
    private const val SPACE_FREQ = 1562.5 // logical 0
    private const val BAUD_RATE = 520.83

    // Attention signal
    private const val ATTN_FREQ_1 = 853.0
    private const val ATTN_FREQ_2 = 960.0
    private const val ATTN_DURATION = 8.0

    private var audioTrack: AudioTrack? = null

    actual fun play() {
        stop()

        try {
            val signal = generateEASSignal()

            val track =
                AudioTrack
                    .Builder()
                    .setAudioAttributes(
                        AudioAttributes
                            .Builder()
                            .setUsage(AudioAttributes.USAGE_ALARM)
                            .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                            .build(),
                    ).setAudioFormat(
                        AudioFormat
                            .Builder()
                            .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                            .setSampleRate(SAMPLE_RATE)
                            .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                            .build(),
                    ).setBufferSizeInBytes(signal.size * 2)
                    .setTransferMode(AudioTrack.MODE_STATIC)
                    .build()

            if (track.state != AudioTrack.STATE_INITIALIZED) {
                logW("EmergencyTonePlayer", "AudioTrack failed to initialize")
                track.release()
                return
            }

            track.write(signal, 0, signal.size)
            track.play()
            audioTrack = track
        } catch (e: Exception) {
            logW("EmergencyTonePlayer", "Failed to play EAS tone: ${e.message}")
        }
    }

    actual fun stop() {
        audioTrack?.let {
            try {
                it.stop()
                it.release()
            } catch (e: Exception) {
                logW("EmergencyTonePlayer", "Failed to stop audio track")
            }
        }
        audioTrack = null
    }

    // ── Signal generation ────────────────────────────────────────

    private fun generateEASSignal(): ShortArray {
        val sameBytes = buildSameHeader()
        val burst = generateFSK(sameBytes)
        val pause = silence(1.0)
        val attention = generateDualTone(ATTN_FREQ_1, ATTN_FREQ_2, ATTN_DURATION)

        // Three identical SAME bursts, 1-second gaps, then attention tone
        return burst + pause + burst + pause + burst + pause + attention
    }

    /**
     * Builds a realistic SAME header byte sequence:
     *   16 × 0xAB preamble  +  "ZCZC-EAS-RWT-012345-..."
     */
    private fun buildSameHeader(): ByteArray {
        val preamble = ByteArray(16) { 0xAB.toByte() }
        val header = "ZCZC-EAS-RWT-012345-012345+0030-0000000-SHYTALK -".toByteArray(Charsets.US_ASCII)
        return preamble + header
    }

    /**
     * Encodes bytes as AFSK (Audio Frequency-Shift Keying).
     * Each byte is transmitted LSB-first, 8 data bits, per the SAME spec.
     */
    private fun generateFSK(data: ByteArray): ShortArray {
        val samplesPerBit = (SAMPLE_RATE / BAUD_RATE).toInt() // ~84.67 → 85
        val totalSamples = data.size * 8 * samplesPerBit
        val buffer = ShortArray(totalSamples)

        var idx = 0
        var phase = 0.0 // continuous phase to avoid clicks

        for (byte in data) {
            for (bit in 0 until 8) {
                val isOne = ((byte.toInt() shr bit) and 1) == 1 // LSB first
                val freq = if (isOne) MARK_FREQ else SPACE_FREQ
                val phaseInc = 2.0 * PI * freq / SAMPLE_RATE

                for (s in 0 until samplesPerBit) {
                    val sample = sin(phase) * AMPLITUDE
                    buffer[idx++] = (sample * Short.MAX_VALUE).toInt().toShort()
                    phase += phaseInc
                }
            }
        }

        // Trim to actual written length (in case of rounding)
        return if (idx < buffer.size) buffer.copyOf(idx) else buffer
    }

    /** Generates silence of the given duration. */
    private fun silence(seconds: Double): ShortArray = ShortArray((SAMPLE_RATE * seconds).toInt())

    /** Generates two simultaneous sine waves (the EBS attention tone). */
    private fun generateDualTone(
        freq1: Double,
        freq2: Double,
        seconds: Double,
    ): ShortArray {
        val numSamples = (SAMPLE_RATE * seconds).toInt()
        val buffer = ShortArray(numSamples)
        for (i in 0 until numSamples) {
            val t = i.toDouble() / SAMPLE_RATE
            val sample = (sin(2 * PI * freq1 * t) + sin(2 * PI * freq2 * t)) * 0.5 * AMPLITUDE
            buffer[i] = (sample * Short.MAX_VALUE).toInt().toShort()
        }
        return buffer
    }
}
