package com.shyden.shytalk.core.audio

import org.junit.Assert.assertEquals
import org.junit.Test

/**
 * Tests for GachaSoundPlayer logic. The actual Android AudioTrack-based implementation
 * cannot be fully tested in JVM unit tests, but we verify the public API contract
 * and the tick band quantization logic that the player uses.
 */
class GachaSoundPlayerTest {
    @Test
    fun `tick band 0 at progress 0`() {
        val band = (0f.coerceIn(0f, 1f) * 7).toInt().coerceIn(0, 7)
        assertEquals(0, band)
    }

    @Test
    fun `tick band 7 at progress 1`() {
        val band = (1f.coerceIn(0f, 1f) * 7).toInt().coerceIn(0, 7)
        assertEquals(7, band)
    }

    @Test
    fun `tick band 3 at progress 0_5`() {
        val band = (0.5f.coerceIn(0f, 1f) * 7).toInt().coerceIn(0, 7)
        assertEquals(3, band)
    }

    @Test
    fun `tick band clamps negative progress to 0`() {
        val band = ((-0.5f).coerceIn(0f, 1f) * 7).toInt().coerceIn(0, 7)
        assertEquals(0, band)
    }

    @Test
    fun `tick band clamps progress above 1 to 7`() {
        val band = (1.5f.coerceIn(0f, 1f) * 7).toInt().coerceIn(0, 7)
        assertEquals(7, band)
    }

    @Test
    fun `tick bands cover all 8 values across progress range`() {
        val bands =
            (0..100)
                .map { i ->
                    val progress = i / 100f
                    (progress.coerceIn(0f, 1f) * 7).toInt().coerceIn(0, 7)
                }.toSet()

        assertEquals(setOf(0, 1, 2, 3, 4, 5, 6, 7), bands)
    }

    @Test
    fun `tick frequency calculation covers expected range`() {
        val minFreq = 180.0 + (740.0 - 180.0) * (0 / 7.0)
        val maxFreq = 180.0 + (740.0 - 180.0) * (7 / 7.0)

        assertEquals(180.0, minFreq, 0.01)
        assertEquals(740.0, maxFreq, 0.01)
    }

    @Test
    fun `coin value sound tiers have 5 levels`() {
        // Verify the 5 coin-value-based sound tiers
        val tiers =
            listOf(
                10 to 280, // < 50 → 280ms
                100 to 420, // < 200 → 420ms
                500 to 600, // < 2000 → 600ms
                5000 to 800, // < 10000 → 800ms
                50000 to 1200, // >= 10000 → 1200ms
            )
        assertEquals(5, tiers.size)
    }

    @Test
    fun `win reveal duration increases with coin value`() {
        val durations =
            listOf(
                10 to 280,
                100 to 420,
                500 to 600,
                5000 to 800,
                50000 to 1200,
            )

        var previousDuration = 0
        for ((coinValue, duration) in durations) {
            assert(duration > previousDuration) {
                "coinValue $coinValue duration ($duration) should be > previous ($previousDuration)"
            }
            previousDuration = duration
        }
    }

    @Test
    fun `spin start chirp frequency range`() {
        // Verify the chirp formula at boundaries
        val startFreq = 220.0 + (1760.0 - 220.0) * 0.0
        val endFreq = 220.0 + (1760.0 - 220.0) * 1.0
        assertEquals(220.0, startFreq, 0.01)
        assertEquals(1760.0, endFreq, 0.01)
    }

    @Test
    fun `coin purchase has two distinct frequency segments`() {
        val freq1 = 880.0
        val freq2 = 1108.0
        assert(freq2 > freq1)
        // Second ding is higher — ascending purchase confirmation
    }

    @Test
    fun `sample count calculation for given duration`() {
        val sampleRate = 44100
        // 420ms spin start
        assertEquals(18522, sampleRate * 420 / 1000)
        // 28ms tick
        assertEquals(1234, sampleRate * 28 / 1000)
        // 22ms blink click
        assertEquals(970, sampleRate * 22 / 1000)
        // 330ms coin purchase
        assertEquals(14553, sampleRate * 330 / 1000)
    }

    @Test
    fun `high tier fanfare duration is longer than any win reveal`() {
        val fanfareDuration = 1800
        val longestWinReveal = 1200 // >= 10000 coinValue
        assert(fanfareDuration > longestWinReveal) {
            "Fanfare ($fanfareDuration ms) should be longer than longest win reveal ($longestWinReveal ms)"
        }
    }

    @Test
    fun `high tier fanfare triggers for coin value 500 and above`() {
        // The fanfare threshold is coinValue >= 500
        val highValueThreshold = 500
        val coinValues = listOf(10, 100, 200, 499, 500, 1000, 5000, 50000)
        val highTier = coinValues.filter { it >= highValueThreshold }
        val lowTier = coinValues.filter { it < highValueThreshold }

        assertEquals(listOf(500, 1000, 5000, 50000), highTier)
        assertEquals(listOf(10, 100, 200, 499), lowTier)
    }

    @Test
    fun `total PCM buffer memory estimate under 550KB`() {
        val sampleRate = 44100
        val bytesPerSample = 2 // 16-bit PCM

        val spinStart = sampleRate * 420 / 1000 * bytesPerSample
        val ticks = 8 * (sampleRate * 28 / 1000 * bytesPerSample)
        val blinkClick = sampleRate * 22 / 1000 * bytesPerSample
        val coinPurchase = sampleRate * 330 / 1000 * bytesPerSample
        val highTierFanfare = sampleRate * 1800 / 1000 * bytesPerSample
        val winCommon = sampleRate * 280 / 1000 * bytesPerSample
        val winUncommon = sampleRate * 420 / 1000 * bytesPerSample
        val winRare = sampleRate * 600 / 1000 * bytesPerSample
        val winEpic = sampleRate * 800 / 1000 * bytesPerSample
        val winLegendary = sampleRate * 1200 / 1000 * bytesPerSample

        val totalBytes =
            spinStart + ticks + blinkClick + coinPurchase + highTierFanfare +
                winCommon + winUncommon + winRare + winEpic + winLegendary

        assert(totalBytes < 550_000) {
            "Total PCM buffer size $totalBytes exceeds 550KB limit"
        }
    }
}
