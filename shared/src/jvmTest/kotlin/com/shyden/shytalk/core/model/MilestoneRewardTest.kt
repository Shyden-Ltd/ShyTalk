package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

class MilestoneRewardTest {
    // ── fromMap ─────────────────────────────────────────────────────

    @Test
    fun `fromMap parses coins reward`() {
        val map =
            mapOf<String, Any?>(
                "type" to "coins",
                "amount" to 500,
                "quantity" to 1,
            )

        val reward = MilestoneReward.fromMap(map)

        assertEquals("coins", reward.type)
        assertEquals(500, reward.amount)
        assertNull(reward.giftId)
        assertEquals(1, reward.quantity)
    }

    @Test
    fun `fromMap parses gift reward`() {
        val map =
            mapOf<String, Any?>(
                "type" to "gift",
                "amount" to 0,
                "giftId" to "gift-diamond",
                "quantity" to 3,
            )

        val reward = MilestoneReward.fromMap(map)

        assertEquals("gift", reward.type)
        assertEquals(0, reward.amount)
        assertEquals("gift-diamond", reward.giftId)
        assertEquals(3, reward.quantity)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val reward = MilestoneReward.fromMap(emptyMap())

        assertEquals("coins", reward.type)
        assertEquals(0, reward.amount)
        assertNull(reward.giftId)
        assertEquals(1, reward.quantity)
    }

    @Test
    fun `fromMap handles missing type defaults to coins`() {
        val map = mapOf<String, Any?>("amount" to 100)

        val reward = MilestoneReward.fromMap(map)

        assertEquals("coins", reward.type)
    }

    @Test
    fun `fromMap handles null type defaults to coins`() {
        val map = mapOf<String, Any?>("type" to null)

        val reward = MilestoneReward.fromMap(map)

        assertEquals("coins", reward.type)
    }

    @Test
    fun `fromMap handles Double amount`() {
        val map =
            mapOf<String, Any?>(
                "type" to "coins",
                "amount" to 250.0,
            )

        val reward = MilestoneReward.fromMap(map)

        assertEquals(250, reward.amount)
    }

    @Test
    fun `fromMap handles Long amount`() {
        val map =
            mapOf<String, Any?>(
                "type" to "coins",
                "amount" to 1000L,
            )

        val reward = MilestoneReward.fromMap(map)

        assertEquals(1000, reward.amount)
    }

    @Test
    fun `fromMap handles Long quantity`() {
        val map =
            mapOf<String, Any?>(
                "type" to "gift",
                "giftId" to "gift-rose",
                "quantity" to 5L,
            )

        val reward = MilestoneReward.fromMap(map)

        assertEquals(5, reward.quantity)
    }

    @Test
    fun `fromMap handles null giftId`() {
        val map =
            mapOf<String, Any?>(
                "type" to "coins",
                "amount" to 100,
                "giftId" to null,
            )

        val reward = MilestoneReward.fromMap(map)

        assertNull(reward.giftId)
    }

    // ── Default constructor ─────────────────────────────────────────

    @Test
    fun `default constructor sets expected values`() {
        val reward = MilestoneReward()

        assertEquals("coins", reward.type)
        assertEquals(0, reward.amount)
        assertNull(reward.giftId)
        assertEquals(1, reward.quantity)
    }
}
