package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull
import kotlin.test.assertTrue

class TransactionTest {
    // ── fromMap ─────────────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "type" to "GIFT_SENT",
                "amount" to -100L,
                "currency" to "COINS",
                "balanceAfter" to 900L,
                "giftId" to "gift-1",
                "giftName" to "Rose",
                "recipientId" to "user-2",
                "senderId" to "user-1",
                "pullCount" to 3,
                "details" to "Sent Rose to user-2",
                "timestamp" to 1705326600000L,
            )

        val tx = Transaction.fromMap(map, "tx-1")

        assertEquals("tx-1", tx.id)
        assertEquals(TransactionType.GIFT_SENT, tx.type)
        assertEquals(-100L, tx.amount)
        assertEquals(CurrencyType.COINS, tx.currency)
        assertEquals(900L, tx.balanceAfter)
        assertEquals("gift-1", tx.giftId)
        assertEquals("Rose", tx.giftName)
        assertEquals("user-2", tx.recipientId)
        assertEquals("user-1", tx.senderId)
        assertEquals(3, tx.pullCount)
        assertEquals("Sent Rose to user-2", tx.details)
        assertEquals(1705326600000L, tx.timestamp)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val tx = Transaction.fromMap(emptyMap(), "tx-2")

        assertEquals("tx-2", tx.id)
        assertEquals(TransactionType.PURCHASE, tx.type)
        assertEquals(0L, tx.amount)
        assertEquals(CurrencyType.COINS, tx.currency)
        assertEquals(0L, tx.balanceAfter)
        assertNull(tx.giftId)
        assertNull(tx.giftName)
        assertNull(tx.recipientId)
        assertNull(tx.senderId)
        assertNull(tx.pullCount)
        assertNull(tx.details)
        assertEquals(0L, tx.timestamp)
    }

    // ── TransactionType parsing ─────────────────────────────────────

    @Test
    fun `fromMap parses PURCHASE type`() {
        val map = mapOf<String, Any?>("type" to "PURCHASE")
        val tx = Transaction.fromMap(map, "tx")
        assertEquals(TransactionType.PURCHASE, tx.type)
    }

    @Test
    fun `fromMap parses GACHA_PULL type`() {
        val map = mapOf<String, Any?>("type" to "GACHA_PULL")
        val tx = Transaction.fromMap(map, "tx")
        assertEquals(TransactionType.GACHA_PULL, tx.type)
    }

    @Test
    fun `fromMap parses GIFT_RECEIVED type`() {
        val map = mapOf<String, Any?>("type" to "GIFT_RECEIVED")
        val tx = Transaction.fromMap(map, "tx")
        assertEquals(TransactionType.GIFT_RECEIVED, tx.type)
    }

    @Test
    fun `fromMap parses BEAN_REDEEM type`() {
        val map = mapOf<String, Any?>("type" to "BEAN_REDEEM")
        val tx = Transaction.fromMap(map, "tx")
        assertEquals(TransactionType.BEAN_REDEEM, tx.type)
    }

    @Test
    fun `fromMap parses DAILY_REWARD type`() {
        val map = mapOf<String, Any?>("type" to "DAILY_REWARD")
        val tx = Transaction.fromMap(map, "tx")
        assertEquals(TransactionType.DAILY_REWARD, tx.type)
    }

    @Test
    fun `fromMap parses SUBSCRIPTION type`() {
        val map = mapOf<String, Any?>("type" to "SUBSCRIPTION")
        val tx = Transaction.fromMap(map, "tx")
        assertEquals(TransactionType.SUBSCRIPTION, tx.type)
    }

    @Test
    fun `fromMap parses ADMIN_ADJUSTMENT type`() {
        val map = mapOf<String, Any?>("type" to "ADMIN_ADJUSTMENT")
        val tx = Transaction.fromMap(map, "tx")
        assertEquals(TransactionType.ADMIN_ADJUSTMENT, tx.type)
    }

    @Test
    fun `fromMap parses ADMIN_BACKPACK type`() {
        val map = mapOf<String, Any?>("type" to "ADMIN_BACKPACK")
        val tx = Transaction.fromMap(map, "tx")
        assertEquals(TransactionType.ADMIN_BACKPACK, tx.type)
    }

    @Test
    fun `fromMap defaults to PURCHASE for unknown type`() {
        val map = mapOf<String, Any?>("type" to "UNKNOWN")
        val tx = Transaction.fromMap(map, "tx")
        assertEquals(TransactionType.PURCHASE, tx.type)
    }

    @Test
    fun `fromMap defaults to PURCHASE for null type`() {
        val map = mapOf<String, Any?>("type" to null)
        val tx = Transaction.fromMap(map, "tx")
        assertEquals(TransactionType.PURCHASE, tx.type)
    }

    // ── CurrencyType parsing ────────────────────────────────────────

    @Test
    fun `fromMap parses BEANS currency`() {
        val map = mapOf<String, Any?>("currency" to "BEANS")
        val tx = Transaction.fromMap(map, "tx")
        assertEquals(CurrencyType.BEANS, tx.currency)
    }

    @Test
    fun `fromMap defaults to COINS for unknown currency`() {
        val map = mapOf<String, Any?>("currency" to "GEMS")
        val tx = Transaction.fromMap(map, "tx")
        assertEquals(CurrencyType.COINS, tx.currency)
    }

    @Test
    fun `fromMap defaults to COINS for null currency`() {
        val map = mapOf<String, Any?>("currency" to null)
        val tx = Transaction.fromMap(map, "tx")
        assertEquals(CurrencyType.COINS, tx.currency)
    }

    // ── Number type handling ────────────────────────────────────────

    @Test
    fun `fromMap handles Int for amount`() {
        val map = mapOf<String, Any?>("amount" to 500)
        val tx = Transaction.fromMap(map, "tx")
        assertEquals(500L, tx.amount)
    }

    @Test
    fun `fromMap handles Double for amount`() {
        val map = mapOf<String, Any?>("amount" to 500.0)
        val tx = Transaction.fromMap(map, "tx")
        assertEquals(500L, tx.amount)
    }

    @Test
    fun `fromMap handles null timestamp`() {
        val map = mapOf<String, Any?>("timestamp" to null)
        val tx = Transaction.fromMap(map, "tx")
        assertEquals(0L, tx.timestamp)
    }

    // ── TransactionType enum ────────────────────────────────────────

    @Test
    fun `TransactionType has expected values`() {
        val types = TransactionType.entries
        assertEquals(9, types.size)
    }

    // ── CurrencyType enum ───────────────────────────────────────────

    @Test
    fun `CurrencyType has COINS and BEANS`() {
        val types = CurrencyType.entries
        assertEquals(2, types.size)
        assertTrue(CurrencyType.COINS in types)
        assertTrue(CurrencyType.BEANS in types)
    }
}
