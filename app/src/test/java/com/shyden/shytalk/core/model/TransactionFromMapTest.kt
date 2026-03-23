package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class TransactionFromMapTest {
    @Test
    fun `complete valid map parses correctly`() {
        val map =
            mapOf<String, Any?>(
                "type" to "GIFT_SENT",
                "amount" to 100L,
                "currency" to "COINS",
                "balanceAfter" to 900L,
                "giftId" to "rose",
                "giftName" to "Rose",
                "recipientId" to "user-2",
                "senderId" to "user-1",
                "pullCount" to 1,
                "details" to "Sent a gift",
                "timestamp" to 1000L,
            )
        val tx = Transaction.fromMap(map, "tx-1")

        assertEquals("tx-1", tx.id)
        assertEquals(TransactionType.GIFT_SENT, tx.type)
        assertEquals(100L, tx.amount)
        assertEquals(CurrencyType.COINS, tx.currency)
        assertEquals(900L, tx.balanceAfter)
        assertEquals("rose", tx.giftId)
        assertEquals("Rose", tx.giftName)
        assertEquals("user-2", tx.recipientId)
        assertEquals("user-1", tx.senderId)
        assertEquals(1, tx.pullCount)
        assertEquals("Sent a gift", tx.details)
        assertEquals(1000L, tx.timestamp)
    }

    @Test
    fun `all TransactionType enum values parse correctly`() {
        for (type in TransactionType.entries) {
            val map = mapOf<String, Any?>("type" to type.name)
            val tx = Transaction.fromMap(map, "tx-1")
            assertEquals(type, tx.type)
        }
    }

    @Test
    fun `invalid type falls back to PURCHASE`() {
        val map = mapOf<String, Any?>("type" to "INVALID_TYPE")
        val tx = Transaction.fromMap(map, "tx-1")
        assertEquals(TransactionType.PURCHASE, tx.type)
    }

    @Test
    fun `missing type defaults to PURCHASE`() {
        val tx = Transaction.fromMap(emptyMap(), "tx-1")
        assertEquals(TransactionType.PURCHASE, tx.type)
    }

    @Test
    fun `all CurrencyType enum values parse correctly`() {
        for (currency in CurrencyType.entries) {
            val map = mapOf<String, Any?>("currency" to currency.name)
            val tx = Transaction.fromMap(map, "tx-1")
            assertEquals(currency, tx.currency)
        }
    }

    @Test
    fun `invalid currency falls back to COINS`() {
        val map = mapOf<String, Any?>("currency" to "INVALID_CURRENCY")
        val tx = Transaction.fromMap(map, "tx-1")
        assertEquals(CurrencyType.COINS, tx.currency)
    }

    @Test
    fun `optional fields are null when missing`() {
        val tx = Transaction.fromMap(emptyMap(), "tx-1")

        assertNull(tx.giftId)
        assertNull(tx.giftName)
        assertNull(tx.recipientId)
        assertNull(tx.senderId)
        assertNull(tx.pullCount)
        assertNull(tx.details)
    }

    @Test
    fun `Long timestamp conversion works`() {
        val map = mapOf<String, Any?>("timestamp" to 1234567890L)
        val tx = Transaction.fromMap(map, "tx-1")
        assertEquals(1234567890L, tx.timestamp)
    }

    @Test
    fun `Double timestamp conversion works`() {
        val map = mapOf<String, Any?>("timestamp" to 1234567890.0)
        val tx = Transaction.fromMap(map, "tx-1")
        assertEquals(1234567890L, tx.timestamp)
    }

    @Test
    fun `amount accepts Number types`() {
        val mapLong = mapOf<String, Any?>("amount" to 500L)
        val mapInt = mapOf<String, Any?>("amount" to 500)
        val mapDouble = mapOf<String, Any?>("amount" to 500.0)

        assertEquals(500L, Transaction.fromMap(mapLong, "tx-1").amount)
        assertEquals(500L, Transaction.fromMap(mapInt, "tx-1").amount)
        assertEquals(500L, Transaction.fromMap(mapDouble, "tx-1").amount)
    }

    @Test
    fun `empty map returns defaults`() {
        val tx = Transaction.fromMap(emptyMap(), "tx-1")

        assertEquals("tx-1", tx.id)
        assertEquals(TransactionType.PURCHASE, tx.type)
        assertEquals(0L, tx.amount)
        assertEquals(CurrencyType.COINS, tx.currency)
        assertEquals(0L, tx.balanceAfter)
        assertEquals(0L, tx.timestamp)
    }
}
