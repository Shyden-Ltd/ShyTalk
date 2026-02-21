package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Test

class EconomyConfigFromMapTest {

    @Test
    fun `fromMap parses all fields`() {
        val map = mapOf<String, Any?>(
            "beanConversionRate" to 0.5,
            "pullCosts" to mapOf("1" to 20, "10" to 180, "100" to 1500),
            "broadcastSendThreshold" to 8000L,
            "broadcastWinThreshold" to 10000L
        )

        val config = EconomyConfig.fromMap(map)

        assertEquals(0.5, config.beanConversionRate, 0.001)
        assertEquals(20, config.pullCosts[1])
        assertEquals(180, config.pullCosts[10])
        assertEquals(1500, config.pullCosts[100])
        assertEquals(8000, config.broadcastSendThreshold)
        assertEquals(10000, config.broadcastWinThreshold)
    }

    @Test
    fun `fromMap uses defaults for missing fields`() {
        val config = EconomyConfig.fromMap(emptyMap())

        assertEquals(0.6, config.beanConversionRate, 0.001)
        assertTrue(config.pullCosts.isEmpty())
        assertEquals(5000, config.broadcastSendThreshold)
        assertEquals(5000, config.broadcastWinThreshold)
    }

    @Test
    fun `fromMap handles partial threshold override`() {
        val map = mapOf<String, Any?>(
            "broadcastSendThreshold" to 3000L
        )

        val config = EconomyConfig.fromMap(map)

        assertEquals(3000, config.broadcastSendThreshold)
        assertEquals(5000, config.broadcastWinThreshold) // default
    }

    @Test
    fun `fromMap handles integer thresholds`() {
        val map = mapOf<String, Any?>(
            "broadcastSendThreshold" to 1000,
            "broadcastWinThreshold" to 2000
        )

        val config = EconomyConfig.fromMap(map)

        assertEquals(1000, config.broadcastSendThreshold)
        assertEquals(2000, config.broadcastWinThreshold)
    }

    @Test
    fun `fromMap handles null thresholds with defaults`() {
        val map = mapOf<String, Any?>(
            "broadcastSendThreshold" to null,
            "broadcastWinThreshold" to null
        )

        val config = EconomyConfig.fromMap(map)

        assertEquals(5000, config.broadcastSendThreshold)
        assertEquals(5000, config.broadcastWinThreshold)
    }

    @Test
    fun `default constructor has correct threshold defaults`() {
        val config = EconomyConfig()

        assertEquals(5000, config.broadcastSendThreshold)
        assertEquals(5000, config.broadcastWinThreshold)
    }

    @Test
    fun `fromMap handles non-standard pullCosts format`() {
        val map = mapOf<String, Any?>(
            "pullCosts" to "not a map"
        )

        val config = EconomyConfig.fromMap(map)

        // Falls back to empty map
        assertTrue(config.pullCosts.isEmpty())
    }
}
