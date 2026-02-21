package com.shyden.shytalk.core.audio

import android.media.AudioAttributes
import android.media.AudioFormat
import android.media.AudioTrack
import kotlin.math.PI
import kotlin.math.cos
import kotlin.math.exp
import kotlin.math.sin

private const val SAMPLE_RATE = 44100

/** Coin-value thresholds for sound tiers (replacing bracket tiers). */
private enum class SoundTier { COMMON, UNCOMMON, RARE, EPIC, LEGENDARY }

private fun soundTierForCoinValue(coinValue: Int): SoundTier = when {
    coinValue < 50 -> SoundTier.COMMON
    coinValue < 200 -> SoundTier.UNCOMMON
    coinValue < 2000 -> SoundTier.RARE
    coinValue < 10000 -> SoundTier.EPIC
    else -> SoundTier.LEGENDARY
}

actual object GachaSoundPlayer {

    private var spinStartTrack: AudioTrack? = null
    private var blinkClickTrack: AudioTrack? = null
    private var coinPurchaseTrack: AudioTrack? = null
    private var highTierFanfareTrack: AudioTrack? = null
    private val tickTracks = arrayOfNulls<AudioTrack>(8)
    private val winTracks = mutableMapOf<SoundTier, AudioTrack>()
    private var initialized = false

    actual fun init() {
        if (initialized) return
        initialized = true
        spinStartTrack = buildTrack(generateSpinStart())
        blinkClickTrack = buildTrack(generateBlinkClick())
        coinPurchaseTrack = buildTrack(generateCoinPurchase())
        highTierFanfareTrack = buildTrack(generateHighTierFanfare())
        for (band in 0 until 8) {
            tickTracks[band] = buildTrack(generateTick(band))
        }
        SoundTier.entries.forEach { tier ->
            winTracks[tier] = buildTrack(generateWinReveal(tier))
        }
    }

    actual fun release() {
        if (!initialized) return
        initialized = false
        spinStartTrack?.release(); spinStartTrack = null
        blinkClickTrack?.release(); blinkClickTrack = null
        coinPurchaseTrack?.release(); coinPurchaseTrack = null
        highTierFanfareTrack?.release(); highTierFanfareTrack = null
        tickTracks.indices.forEach { tickTracks[it]?.release(); tickTracks[it] = null }
        winTracks.values.forEach { it.release() }
        winTracks.clear()
    }

    actual fun playSpinStart() = replay(spinStartTrack)
    actual fun playBlinkClick() = replay(blinkClickTrack)
    actual fun playCoinPurchase() = replay(coinPurchaseTrack)
    actual fun playHighTierFanfare() = replay(highTierFanfareTrack)

    actual fun playTick(progress: Float) {
        val band = (progress.coerceIn(0f, 1f) * 7).toInt().coerceIn(0, 7)
        replay(tickTracks[band])
    }

    actual fun playWinReveal(coinValue: Int) {
        replay(winTracks[soundTierForCoinValue(coinValue)])
    }

    // -- Playback helper --

    private fun replay(track: AudioTrack?) {
        track ?: return
        try {
            track.pause()
            track.reloadStaticData()
            track.play()
        } catch (_: Exception) {}
    }

    // -- Track builder --

    private fun buildTrack(samples: ShortArray): AudioTrack {
        val bufferSize = samples.size * 2
        val track = AudioTrack.Builder()
            .setAudioAttributes(
                AudioAttributes.Builder()
                    .setUsage(AudioAttributes.USAGE_GAME)
                    .setContentType(AudioAttributes.CONTENT_TYPE_SONIFICATION)
                    .build()
            )
            .setAudioFormat(
                AudioFormat.Builder()
                    .setEncoding(AudioFormat.ENCODING_PCM_16BIT)
                    .setSampleRate(SAMPLE_RATE)
                    .setChannelMask(AudioFormat.CHANNEL_OUT_MONO)
                    .build()
            )
            .setBufferSizeInBytes(bufferSize)
            .setTransferMode(AudioTrack.MODE_STATIC)
            .build()
        track.write(samples, 0, samples.size)
        return track
    }

    // -- Sound generators --

    /** Ascending chirp 220->1760Hz, 420ms, cos² attack/decay */
    private fun generateSpinStart(): ShortArray {
        val durationMs = 420
        val numSamples = SAMPLE_RATE * durationMs / 1000
        val samples = ShortArray(numSamples)
        val amplitude = 0.28f
        val attackMs = 40
        val decayMs = 80
        val attackSamples = SAMPLE_RATE * attackMs / 1000
        val decaySamples = SAMPLE_RATE * decayMs / 1000

        var phase = 0.0
        for (i in 0 until numSamples) {
            val t = i.toFloat() / numSamples
            val freq = 220.0 + (1760.0 - 220.0) * t
            phase += 2.0 * PI * freq / SAMPLE_RATE
            var envelope = 1f
            if (i < attackSamples) {
                val x = (i.toFloat() / attackSamples * PI / 2).toFloat()
                envelope = cos(x) * cos(x)
                val at = i.toFloat() / attackSamples
                envelope = (sin(at * PI / 2) * sin(at * PI / 2)).toFloat()
            } else if (i > numSamples - decaySamples) {
                val dt = (i - (numSamples - decaySamples)).toFloat() / decaySamples
                envelope = (cos(dt * PI / 2) * cos(dt * PI / 2)).toFloat()
            }
            samples[i] = (sin(phase) * amplitude * envelope * Short.MAX_VALUE).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
        return samples
    }

    /** Short tick, pitch mapped to 8 bands (180->740Hz), 28ms */
    private fun generateTick(band: Int): ShortArray {
        val durationMs = 28
        val numSamples = SAMPLE_RATE * durationMs / 1000
        val samples = ShortArray(numSamples)
        val freq = 180.0 + (740.0 - 180.0) * (band / 7.0)
        val amplitude = 0.20f
        val attackSamples = SAMPLE_RATE * 4 / 1000
        val decaySamples = SAMPLE_RATE * 4 / 1000

        var phase = 0.0
        for (i in 0 until numSamples) {
            phase += 2.0 * PI * freq / SAMPLE_RATE
            var envelope = 1f
            if (i < attackSamples) {
                val at = i.toFloat() / attackSamples
                envelope = (sin(at * PI / 2) * sin(at * PI / 2)).toFloat()
            } else if (i > numSamples - decaySamples) {
                val dt = (i - (numSamples - decaySamples)).toFloat() / decaySamples
                envelope = (sin((1 - dt) * PI / 2) * sin((1 - dt) * PI / 2)).toFloat()
            }
            samples[i] = (sin(phase) * amplitude * envelope * Short.MAX_VALUE).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
        return samples
    }

    /** Sharp click at 660Hz, 22ms, exponential decay */
    private fun generateBlinkClick(): ShortArray {
        val durationMs = 22
        val numSamples = SAMPLE_RATE * durationMs / 1000
        val samples = ShortArray(numSamples)
        val amplitude = 0.30f

        var phase = 0.0
        for (i in 0 until numSamples) {
            phase += 2.0 * PI * 660.0 / SAMPLE_RATE
            val envelope = exp(-5.0 * i.toDouble() / numSamples).toFloat()
            samples[i] = (sin(phase) * amplitude * envelope * Short.MAX_VALUE).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
        return samples
    }

    /** Win reveal sound — complexity scales with coin value tier */
    private fun generateWinReveal(tier: SoundTier): ShortArray {
        return when (tier) {
            SoundTier.COMMON -> generateWinCommon()
            SoundTier.UNCOMMON -> generateWinUncommon()
            SoundTier.RARE -> generateWinRare()
            SoundTier.EPIC -> generateWinEpic()
            SoundTier.LEGENDARY -> generateWinLegendary()
        }
    }

    /** COMMON (<50 coins): single C5 tone, 280ms */
    private fun generateWinCommon(): ShortArray {
        val durationMs = 280
        val numSamples = SAMPLE_RATE * durationMs / 1000
        val samples = ShortArray(numSamples)
        val amplitude = 0.25f
        val attackSamples = SAMPLE_RATE * 20 / 1000

        var phase = 0.0
        for (i in 0 until numSamples) {
            phase += 2.0 * PI * 523.0 / SAMPLE_RATE
            var envelope = 1f
            if (i < attackSamples) {
                val at = i.toFloat() / attackSamples
                envelope = (sin(at * PI / 2) * sin(at * PI / 2)).toFloat()
            } else {
                val dt = (i - attackSamples).toFloat() / (numSamples - attackSamples)
                envelope = (1f - dt * dt)
            }
            samples[i] = (sin(phase) * amplitude * envelope * Short.MAX_VALUE).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
        return samples
    }

    /** UNCOMMON (50-199 coins): C5+E5 chord, 420ms */
    private fun generateWinUncommon(): ShortArray {
        val durationMs = 420
        val numSamples = SAMPLE_RATE * durationMs / 1000
        val samples = ShortArray(numSamples)
        val amplitude = 0.25f
        val attackSamples = SAMPLE_RATE * 25 / 1000

        var phase1 = 0.0
        var phase2 = 0.0
        for (i in 0 until numSamples) {
            phase1 += 2.0 * PI * 523.0 / SAMPLE_RATE
            phase2 += 2.0 * PI * 659.0 / SAMPLE_RATE
            var envelope = 1f
            if (i < attackSamples) {
                val at = i.toFloat() / attackSamples
                envelope = (sin(at * PI / 2) * sin(at * PI / 2)).toFloat()
            } else {
                val dt = (i - attackSamples).toFloat() / (numSamples - attackSamples)
                envelope = (1f - dt)
            }
            val value = (sin(phase1) + sin(phase2)) * 0.5 * amplitude * envelope
            samples[i] = (value * Short.MAX_VALUE).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
        return samples
    }

    /** RARE (200-1999 coins): C5+E5+G5 triad + shimmer, 600ms */
    private fun generateWinRare(): ShortArray {
        val durationMs = 600
        val numSamples = SAMPLE_RATE * durationMs / 1000
        val samples = ShortArray(numSamples)
        val amplitude = 0.28f
        val attackSamples = SAMPLE_RATE * 25 / 1000

        var phase1 = 0.0
        var phase2 = 0.0
        var phase3 = 0.0
        var shimmerPhase = 0.0
        for (i in 0 until numSamples) {
            phase1 += 2.0 * PI * 523.0 / SAMPLE_RATE
            phase2 += 2.0 * PI * 659.0 / SAMPLE_RATE
            phase3 += 2.0 * PI * 784.0 / SAMPLE_RATE
            shimmerPhase += 2.0 * PI * 8.0 / SAMPLE_RATE
            var envelope = 1f
            if (i < attackSamples) {
                val at = i.toFloat() / attackSamples
                envelope = (sin(at * PI / 2) * sin(at * PI / 2)).toFloat()
            } else {
                val dt = (i - attackSamples).toFloat() / (numSamples - attackSamples)
                envelope = (1f - dt * 0.7f)
            }
            val shimmer = 1.0 + 0.15 * sin(shimmerPhase)
            val value = (sin(phase1) + sin(phase2) + sin(phase3)) / 3.0 * amplitude * envelope * shimmer
            samples[i] = (value * Short.MAX_VALUE).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
        return samples
    }

    /** EPIC (2000-9999 coins): A4+C#5+E5 + sub-bass 80Hz, 800ms */
    private fun generateWinEpic(): ShortArray {
        val durationMs = 800
        val numSamples = SAMPLE_RATE * durationMs / 1000
        val samples = ShortArray(numSamples)
        val amplitude = 0.30f
        val attackSamples = SAMPLE_RATE * 30 / 1000

        var phase1 = 0.0
        var phase2 = 0.0
        var phase3 = 0.0
        var subPhase = 0.0
        for (i in 0 until numSamples) {
            phase1 += 2.0 * PI * 440.0 / SAMPLE_RATE
            phase2 += 2.0 * PI * 554.0 / SAMPLE_RATE
            phase3 += 2.0 * PI * 659.0 / SAMPLE_RATE
            subPhase += 2.0 * PI * 80.0 / SAMPLE_RATE
            var envelope = 1f
            if (i < attackSamples) {
                val at = i.toFloat() / attackSamples
                envelope = (sin(at * PI / 2) * sin(at * PI / 2)).toFloat()
            } else {
                val dt = (i - attackSamples).toFloat() / (numSamples - attackSamples)
                envelope = (1f - dt * 0.5f)
            }
            val chord = (sin(phase1) + sin(phase2) + sin(phase3)) / 3.0
            val sub = sin(subPhase) * 0.3
            val value = (chord + sub) * amplitude * envelope / 1.3
            samples[i] = (value * Short.MAX_VALUE).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
        return samples
    }

    /** LEGENDARY (10000+ coins): 5-note chord + chirp overlay, 1200ms */
    private fun generateWinLegendary(): ShortArray {
        val durationMs = 1200
        val numSamples = SAMPLE_RATE * durationMs / 1000
        val samples = ShortArray(numSamples)
        val amplitude = 0.30f
        val attackSamples = SAMPLE_RATE * 40 / 1000

        var p1 = 0.0; var p2 = 0.0; var p3 = 0.0; var p4 = 0.0; var p5 = 0.0
        var chirpPhase = 0.0
        for (i in 0 until numSamples) {
            p1 += 2.0 * PI * 220.0 / SAMPLE_RATE
            p2 += 2.0 * PI * 440.0 / SAMPLE_RATE
            p3 += 2.0 * PI * 550.0 / SAMPLE_RATE
            p4 += 2.0 * PI * 660.0 / SAMPLE_RATE
            p5 += 2.0 * PI * 880.0 / SAMPLE_RATE
            val t = i.toFloat() / numSamples
            val chirpFreq = 880.0 + 1760.0 * t
            chirpPhase += 2.0 * PI * chirpFreq / SAMPLE_RATE
            var envelope = 1f
            if (i < attackSamples) {
                val at = i.toFloat() / attackSamples
                envelope = (sin(at * PI / 2) * sin(at * PI / 2)).toFloat()
            } else {
                val dt = (i - attackSamples).toFloat() / (numSamples - attackSamples)
                envelope = (1f - dt * 0.4f)
            }
            val chord = (sin(p1) + sin(p2) + sin(p3) + sin(p4) + sin(p5)) / 5.0
            val chirp = sin(chirpPhase) * 0.15 * (1.0 - t)
            val value = (chord + chirp) * amplitude * envelope / 1.15
            samples[i] = (value * Short.MAX_VALUE).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
        return samples
    }

    /** High-tier fanfare: dramatic ascending arpeggio C-E-G-C with layered harmonics, 1800ms */
    private fun generateHighTierFanfare(): ShortArray {
        val durationMs = 1800
        val numSamples = SAMPLE_RATE * durationMs / 1000
        val samples = ShortArray(numSamples)
        val amplitude = 0.32f

        val notes = doubleArrayOf(261.6, 329.6, 392.0, 523.3)
        val noteOnsets = intArrayOf(0, (numSamples * 0.18).toInt(), (numSamples * 0.36).toInt(), (numSamples * 0.52).toInt())
        val noteDuration = (numSamples * 0.55)

        var subPhase = 0.0
        var shimmerPhase = 0.0

        val phases = DoubleArray(notes.size)
        val octavePhases = DoubleArray(notes.size)

        for (i in 0 until numSamples) {
            val t = i.toFloat() / numSamples
            var value = 0.0

            subPhase += 2.0 * PI * 60.0 / SAMPLE_RATE
            val subEnv = if (i < SAMPLE_RATE * 400 / 1000) exp(-4.0 * i.toDouble() / (SAMPLE_RATE * 400 / 1000)) else 0.0
            value += sin(subPhase) * 0.25 * subEnv

            for (n in notes.indices) {
                val onset = noteOnsets[n]
                if (i < onset) continue
                val noteT = (i - onset).toDouble()
                if (noteT > noteDuration) continue

                phases[n] += 2.0 * PI * notes[n] / SAMPLE_RATE
                octavePhases[n] += 2.0 * PI * notes[n] * 2.0 / SAMPLE_RATE

                val attackSamp = SAMPLE_RATE * 20 / 1000
                val noteEnv = if (noteT < attackSamp) {
                    val at = noteT / attackSamp
                    sin(at * PI / 2) * sin(at * PI / 2)
                } else {
                    val dt = (noteT - attackSamp) / (noteDuration - attackSamp)
                    1.0 - dt * 0.6
                }

                value += (sin(phases[n]) * 0.7 + sin(octavePhases[n]) * 0.3) * noteEnv / notes.size
            }

            shimmerPhase += 2.0 * PI * 6.0 / SAMPLE_RATE
            val shimmer = 1.0 + 0.12 * sin(shimmerPhase) * t

            val globalEnv = if (i < SAMPLE_RATE * 30 / 1000) {
                val at = i.toFloat() / (SAMPLE_RATE * 30 / 1000)
                (sin(at * PI / 2) * sin(at * PI / 2)).toDouble()
            } else if (t > 0.85) {
                val dt = (t - 0.85) / 0.15
                (1.0 - dt * dt)
            } else 1.0

            val sample = value * amplitude * shimmer * globalEnv
            samples[i] = (sample * Short.MAX_VALUE).toInt()
                .coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
        return samples
    }

    /** Two sequential dings: 880Hz then 1108Hz, 330ms total */
    private fun generateCoinPurchase(): ShortArray {
        val durationMs = 330
        val numSamples = SAMPLE_RATE * durationMs / 1000
        val samples = ShortArray(numSamples)
        val amplitude = 0.28f
        val halfSamples = numSamples / 2

        var phase = 0.0
        for (i in 0 until numSamples) {
            val freq = if (i < halfSamples) 880.0 else 1108.0
            if (i == halfSamples) phase = 0.0
            phase += 2.0 * PI * freq / SAMPLE_RATE
            val localT = if (i < halfSamples) i.toFloat() / halfSamples else (i - halfSamples).toFloat() / (numSamples - halfSamples)
            val envelope = exp(-3.0 * localT).toFloat()
            samples[i] = (sin(phase) * amplitude * envelope * Short.MAX_VALUE).toInt().coerceIn(Short.MIN_VALUE.toInt(), Short.MAX_VALUE.toInt()).toShort()
        }
        return samples
    }
}
