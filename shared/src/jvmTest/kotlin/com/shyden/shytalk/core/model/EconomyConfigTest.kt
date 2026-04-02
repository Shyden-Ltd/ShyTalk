package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class EconomyConfigTest {
    // ── fromMap basic ───────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "beanConversionRate" to 0.5,
                "pullCosts" to mapOf("1" to 100, "10" to 900),
                "broadcastSendThreshold" to 3000,
                "broadcastWinThreshold" to 4000,
                "maxRoomDurationMinutes" to 480,
                "superShyRoomDurationMinutes" to 960,
                "normalSeatCount" to 8,
                "wheelInnerThreshold" to 25000,
                "dailyBase" to 100,
                "milestoneRewards" to
                    mapOf(
                        "7" to mapOf("type" to "coins", "amount" to 500),
                        "30" to mapOf("type" to "gift", "amount" to 0, "giftId" to "rare-gift", "quantity" to 2),
                    ),
            )

        val config = EconomyConfig.fromMap(map)

        assertEquals(0.5, config.beanConversionRate)
        assertEquals(mapOf(1 to 100, 10 to 900), config.pullCosts)
        assertEquals(3000, config.broadcastSendThreshold)
        assertEquals(4000, config.broadcastWinThreshold)
        assertEquals(480, config.maxRoomDurationMinutes)
        assertEquals(960, config.superShyRoomDurationMinutes)
        assertEquals(8, config.normalSeatCount)
        assertEquals(25000, config.wheelInnerThreshold)
        assertEquals(100, config.dailyBase)
        assertEquals(2, config.milestoneRewards.size)
        assertEquals("coins", config.milestoneRewards[7]?.type)
        assertEquals(500, config.milestoneRewards[7]?.amount)
        assertEquals("gift", config.milestoneRewards[30]?.type)
        assertEquals("rare-gift", config.milestoneRewards[30]?.giftId)
        assertEquals(2, config.milestoneRewards[30]?.quantity)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val config = EconomyConfig.fromMap(emptyMap())

        assertEquals(0.6, config.beanConversionRate)
        assertEquals(emptyMap(), config.pullCosts)
        assertEquals(5000, config.broadcastSendThreshold)
        assertEquals(5000, config.broadcastWinThreshold)
        assertEquals(360, config.maxRoomDurationMinutes)
        assertEquals(720, config.superShyRoomDurationMinutes)
        assertEquals(5, config.normalSeatCount)
        assertEquals(18888, config.wheelInnerThreshold)
        assertEquals(50, config.dailyBase)
        assertEquals(emptyMap(), config.milestoneRewards)
    }

    // ── Number type coercion ────────────────────────────────────────

    @Test
    fun `fromMap handles Long values for Int fields`() {
        val map =
            mapOf<String, Any?>(
                "broadcastSendThreshold" to 3000L,
                "broadcastWinThreshold" to 4000L,
                "maxRoomDurationMinutes" to 480L,
                "normalSeatCount" to 8L,
                "wheelInnerThreshold" to 25000L,
                "dailyBase" to 100L,
            )

        val config = EconomyConfig.fromMap(map)

        assertEquals(3000, config.broadcastSendThreshold)
        assertEquals(4000, config.broadcastWinThreshold)
        assertEquals(480, config.maxRoomDurationMinutes)
        assertEquals(8, config.normalSeatCount)
        assertEquals(25000, config.wheelInnerThreshold)
        assertEquals(100, config.dailyBase)
    }

    @Test
    fun `fromMap handles Double for beanConversionRate`() {
        val map = mapOf<String, Any?>("beanConversionRate" to 0.75)
        val config = EconomyConfig.fromMap(map)
        assertEquals(0.75, config.beanConversionRate)
    }

    @Test
    fun `fromMap handles Int for beanConversionRate`() {
        val map = mapOf<String, Any?>("beanConversionRate" to 1)
        val config = EconomyConfig.fromMap(map)
        assertEquals(1.0, config.beanConversionRate)
    }

    // ── pullCosts parsing ───────────────────────────────────────────

    @Test
    fun `fromMap handles pullCosts with Long values`() {
        val map =
            mapOf<String, Any?>(
                "pullCosts" to mapOf("1" to 100L, "10" to 900L),
            )

        val config = EconomyConfig.fromMap(map)

        assertEquals(mapOf(1 to 100, 10 to 900), config.pullCosts)
    }

    @Test
    fun `fromMap handles pullCosts with non-numeric keys gracefully`() {
        val map =
            mapOf<String, Any?>(
                "pullCosts" to mapOf("abc" to 100, "1" to 200),
            )

        val config = EconomyConfig.fromMap(map)

        assertEquals(1, config.pullCosts.size)
        assertEquals(200, config.pullCosts[1])
    }

    @Test
    fun `fromMap handles null pullCosts`() {
        val map = mapOf<String, Any?>("pullCosts" to null)
        val config = EconomyConfig.fromMap(map)
        assertEquals(emptyMap(), config.pullCosts)
    }

    // ── milestoneRewards parsing ────────────────────────────────────

    @Test
    fun `fromMap handles milestoneRewards with null entries gracefully`() {
        val map =
            mapOf<String, Any?>(
                "milestoneRewards" to mapOf("7" to null, "abc" to mapOf("type" to "coins")),
            )

        val config = EconomyConfig.fromMap(map)

        assertTrue(config.milestoneRewards.isEmpty())
    }

    @Test
    fun `fromMap handles milestoneRewards as non-map type`() {
        val map = mapOf<String, Any?>("milestoneRewards" to "invalid")
        val config = EconomyConfig.fromMap(map)
        assertEquals(emptyMap(), config.milestoneRewards)
    }

    // ── MilestoneReward ─────────────────────────────────────────────

    @Test
    fun `MilestoneReward fromMap defaults`() {
        val reward = MilestoneReward.fromMap(emptyMap())

        assertEquals("coins", reward.type)
        assertEquals(0, reward.amount)
        assertNull(reward.giftId)
        assertEquals(1, reward.quantity)
    }
}
