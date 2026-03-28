package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertNull
import kotlin.test.assertTrue

class GiftTest {
    // ── fromMap basic ───────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "name" to "Diamond Ring",
                "coinValue" to 500,
                "animationUrl" to "https://example.com/anim.json",
                "soundUrl" to "https://example.com/sound.mp3",
                "iconUrl" to "https://example.com/icon.png",
                "order" to 3,
                "expiresAfterDays" to 30,
                "showInStore" to true,
                "showOnWheel" to false,
            )

        val gift = Gift.fromMap(map, "gift-1")

        assertEquals("gift-1", gift.id)
        assertEquals("Diamond Ring", gift.name)
        assertEquals(500, gift.coinValue)
        assertEquals("https://example.com/anim.json", gift.animationUrl)
        assertEquals("https://example.com/sound.mp3", gift.soundUrl)
        assertEquals("https://example.com/icon.png", gift.iconUrl)
        assertEquals(3, gift.order)
        assertEquals(30, gift.expiresAfterDays)
        assertTrue(gift.showInStore)
        assertFalse(gift.showOnWheel)
    }

    @Test
    fun `fromMap defaults for missing fields`() {
        val gift = Gift.fromMap(emptyMap(), "gift-2")

        assertEquals("gift-2", gift.id)
        assertEquals("", gift.name)
        assertEquals(0, gift.coinValue)
        assertEquals("", gift.animationUrl)
        assertEquals("", gift.soundUrl)
        assertEquals("", gift.iconUrl)
        assertEquals(0, gift.order)
        assertNull(gift.expiresAfterDays)
        assertTrue(gift.showInStore) // default true
        assertTrue(gift.showOnWheel) // default true
    }

    @Test
    fun `fromMap handles Number types for coinValue`() {
        val map = mapOf<String, Any?>("coinValue" to 100L)
        val gift = Gift.fromMap(map, "gift-3")
        assertEquals(100, gift.coinValue)
    }

    @Test
    fun `fromMap handles Double for coinValue`() {
        val map = mapOf<String, Any?>("coinValue" to 100.0)
        val gift = Gift.fromMap(map, "gift-3")
        assertEquals(100, gift.coinValue)
    }

    @Test
    fun `fromMap handles null expiresAfterDays`() {
        val map = mapOf<String, Any?>("expiresAfterDays" to null)
        val gift = Gift.fromMap(map, "gift-4")
        assertNull(gift.expiresAfterDays)
    }

    // ── toMap ────────────────────────────────────────────────────────

    @Test
    fun `toMap includes all fields`() {
        val gift =
            Gift(
                id = "gift-1",
                name = "Rose",
                coinValue = 10,
                animationUrl = "anim",
                soundUrl = "sound",
                iconUrl = "icon",
                order = 1,
                expiresAfterDays = 7,
                showInStore = true,
                showOnWheel = false,
            )

        val map = gift.toMap()

        assertEquals("Rose", map["name"])
        assertEquals(10, map["coinValue"])
        assertEquals("anim", map["animationUrl"])
        assertEquals("sound", map["soundUrl"])
        assertEquals("icon", map["iconUrl"])
        assertEquals(1, map["order"])
        assertEquals(7, map["expiresAfterDays"])
        assertEquals(true, map["showInStore"])
        assertEquals(false, map["showOnWheel"])
    }

    @Test
    fun `toMap does not include id`() {
        val gift = Gift(id = "gift-1", name = "Rose")
        val map = gift.toMap()
        assertFalse("id" in map, "toMap should not include id field")
    }

    // ── roundtrip ───────────────────────────────────────────────────

    @Test
    fun `toMap and fromMap roundtrip preserves data`() {
        val original =
            Gift(
                id = "gift-rt",
                name = "Star",
                coinValue = 250,
                animationUrl = "https://anim.url",
                soundUrl = "https://sound.url",
                iconUrl = "https://icon.url",
                order = 5,
                expiresAfterDays = 14,
                showInStore = false,
                showOnWheel = true,
            )

        val map = original.toMap()
        val restored = Gift.fromMap(map, original.id)

        assertEquals(original, restored)
    }

    @Test
    fun `roundtrip with null expiresAfterDays`() {
        val original =
            Gift(
                id = "gift-null-exp",
                name = "Basic",
                coinValue = 5,
                expiresAfterDays = null,
            )

        val map = original.toMap()
        val restored = Gift.fromMap(map, original.id)

        assertEquals(original.expiresAfterDays, restored.expiresAfterDays)
    }

    // ── SUPER_SHY_TRIAL constant ────────────────────────────────────

    @Test
    fun `SUPER_SHY_TRIAL has expected properties`() {
        val trial = Gift.SUPER_SHY_TRIAL
        assertEquals("super_shy_trial", trial.id)
        assertEquals("Super Shy Trial", trial.name)
        assertEquals(0, trial.coinValue)
        assertEquals(-1, trial.order)
        assertFalse(trial.showInStore)
        assertFalse(trial.showOnWheel)
    }

    // ── Default constructor ─────────────────────────────────────────

    @Test
    fun `default constructor has expected defaults`() {
        val gift = Gift()
        assertEquals("", gift.id)
        assertEquals("", gift.name)
        assertEquals(0, gift.coinValue)
        assertEquals("", gift.animationUrl)
        assertEquals("", gift.soundUrl)
        assertEquals("", gift.iconUrl)
        assertEquals(0, gift.order)
        assertNull(gift.expiresAfterDays)
        assertTrue(gift.showInStore)
        assertTrue(gift.showOnWheel)
    }

    // ── asBool for showInStore/showOnWheel ──────────────────────────

    @Test
    fun `fromMap handles integer boolean for showInStore`() {
        val map = mapOf<String, Any?>("showInStore" to 0)
        val gift = Gift.fromMap(map, "g1")
        assertFalse(gift.showInStore)
    }

    @Test
    fun `fromMap handles integer boolean 1 for showOnWheel`() {
        val map = mapOf<String, Any?>("showOnWheel" to 1)
        val gift = Gift.fromMap(map, "g1")
        assertTrue(gift.showOnWheel)
    }
}
