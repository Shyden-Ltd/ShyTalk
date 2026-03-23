package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class EconomyConfigMilestoneTest {
    // ── EconomyConfig.fromMap — milestoneRewards parsing ──────────────────

    @Test
    fun `milestoneRewards parses numeric-string keys correctly`() {
        val map =
            mapOf<String, Any?>(
                "milestoneRewards" to
                    mapOf(
                        "7" to mapOf("amount" to 100L, "type" to "coins"),
                        "14" to mapOf("amount" to 200L, "type" to "coins"),
                        "30" to mapOf("amount" to 500L, "type" to "coins"),
                    ),
            )

        val config = EconomyConfig.fromMap(map)

        assertEquals(3, config.milestoneRewards.size)
        assertEquals(100, config.milestoneRewards[7]?.amount)
        assertEquals(200, config.milestoneRewards[14]?.amount)
        assertEquals(500, config.milestoneRewards[30]?.amount)
    }

    @Test
    fun `milestoneRewards handles malformed inner objects`() {
        // One valid entry and one where the value is not a Map (malformed)
        val map =
            mapOf<String, Any?>(
                "milestoneRewards" to
                    mapOf(
                        "7" to mapOf("amount" to 100L),
                        "14" to "not-a-map", // malformed: value is a String, not a Map
                    ),
            )

        val config = EconomyConfig.fromMap(map)

        // Only the valid entry should be parsed; the malformed one is silently skipped
        assertEquals(1, config.milestoneRewards.size)
        assertEquals(100, config.milestoneRewards[7]?.amount)
        assertNull(config.milestoneRewards[14])
    }

    @Test
    fun `milestoneRewards with non-Map value defaults to empty`() {
        val map =
            mapOf<String, Any?>(
                "milestoneRewards" to "not-a-map",
            )

        val config = EconomyConfig.fromMap(map)

        assertTrue(config.milestoneRewards.isEmpty())
    }

    @Test
    fun `milestoneRewards defaults to empty when key is absent`() {
        val config = EconomyConfig.fromMap(emptyMap())

        assertTrue(config.milestoneRewards.isEmpty())
    }

    @Test
    fun `milestoneRewards skips entries with non-integer string keys`() {
        val map =
            mapOf<String, Any?>(
                "milestoneRewards" to
                    mapOf(
                        "seven" to mapOf("amount" to 100L), // non-parseable key
                        "7" to mapOf("amount" to 200L),
                    ),
            )

        val config = EconomyConfig.fromMap(map)

        // "seven" key can't be parsed as Int — only the "7" entry survives
        assertEquals(1, config.milestoneRewards.size)
        assertEquals(200, config.milestoneRewards[7]?.amount)
    }

    @Test
    fun `milestoneRewards with null value defaults to empty`() {
        val map =
            mapOf<String, Any?>(
                "milestoneRewards" to null,
            )

        val config = EconomyConfig.fromMap(map)

        assertTrue(config.milestoneRewards.isEmpty())
    }

    // ── MilestoneReward.fromMap ────────────────────────────────────────────

    @Test
    fun `MilestoneReward fromMap defaults type to coins`() {
        val reward = MilestoneReward.fromMap(mapOf("amount" to 150))

        assertEquals("coins", reward.type)
    }

    @Test
    fun `MilestoneReward fromMap defaults giftId to null`() {
        val reward = MilestoneReward.fromMap(mapOf("amount" to 150))

        assertNull(reward.giftId)
    }

    @Test
    fun `MilestoneReward fromMap parses type gift with giftId`() {
        val reward =
            MilestoneReward.fromMap(
                mapOf(
                    "type" to "gift",
                    "amount" to 0,
                    "giftId" to "gift-abc",
                    "quantity" to 2,
                ),
            )

        assertEquals("gift", reward.type)
        assertEquals("gift-abc", reward.giftId)
        assertEquals(2, reward.quantity)
    }

    @Test
    fun `MilestoneReward fromMap defaults amount to zero when missing`() {
        val reward = MilestoneReward.fromMap(emptyMap())

        assertEquals(0, reward.amount)
    }

    @Test
    fun `MilestoneReward fromMap defaults quantity to one when missing`() {
        val reward = MilestoneReward.fromMap(emptyMap())

        assertEquals(1, reward.quantity)
    }

    @Test
    fun `MilestoneReward fromMap parses Long amount correctly`() {
        val reward = MilestoneReward.fromMap(mapOf("amount" to 500L))

        assertEquals(500, reward.amount)
    }

    @Test
    fun `MilestoneReward fromMap parses Int amount correctly`() {
        val reward = MilestoneReward.fromMap(mapOf("amount" to 250))

        assertEquals(250, reward.amount)
    }

    @Test
    fun `MilestoneReward default constructor has correct defaults`() {
        val reward = MilestoneReward()

        assertEquals("coins", reward.type)
        assertEquals(0, reward.amount)
        assertNull(reward.giftId)
        assertEquals(1, reward.quantity)
    }

    @Test
    fun `MilestoneReward fromMap ignores wrong type for amount`() {
        val reward = MilestoneReward.fromMap(mapOf("amount" to "not-a-number"))

        assertEquals(0, reward.amount)
    }

    @Test
    fun `milestoneRewards with empty inner map uses MilestoneReward defaults`() {
        val map =
            mapOf<String, Any?>(
                "milestoneRewards" to
                    mapOf(
                        "7" to emptyMap<String, Any?>(),
                    ),
            )

        val config = EconomyConfig.fromMap(map)

        assertEquals(1, config.milestoneRewards.size)
        val reward = config.milestoneRewards[7]!!
        assertEquals("coins", reward.type)
        assertEquals(0, reward.amount)
        assertNull(reward.giftId)
        assertEquals(1, reward.quantity)
    }
}
