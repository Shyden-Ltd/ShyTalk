package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test

class GiftFromMapTest {
    @Test
    fun `fromMap parses complete gift`() {
        val map =
            mapOf<String, Any?>(
                "name" to "Crown",
                "coinValue" to 800L,
                "animationUrl" to "https://example.com/anim.json",
                "soundUrl" to "https://example.com/sound.mp3",
                "iconUrl" to "https://example.com/crown.png",
                "order" to 16L,
            )

        val gift = Gift.fromMap(map, "crown")

        assertEquals("crown", gift.id)
        assertEquals("Crown", gift.name)
        assertEquals(800, gift.coinValue)
        assertEquals("https://example.com/anim.json", gift.animationUrl)
        assertEquals("https://example.com/sound.mp3", gift.soundUrl)
        assertEquals("https://example.com/crown.png", gift.iconUrl)
        assertEquals(16, gift.order)
    }

    @Test
    fun `fromMap handles empty map with defaults`() {
        val gift = Gift.fromMap(emptyMap(), "test")

        assertEquals("test", gift.id)
        assertEquals("", gift.name)
        assertEquals(0, gift.coinValue)
        assertEquals("", gift.animationUrl)
        assertEquals("", gift.soundUrl)
        assertEquals("", gift.iconUrl)
        assertEquals(0, gift.order)
    }

    @Test
    fun `fromMap ignores unknown fields`() {
        val map =
            mapOf<String, Any?>(
                "name" to "Test",
                "bracket" to "RARE", // legacy field — ignored
            )

        val gift = Gift.fromMap(map, "test")

        assertEquals("Test", gift.name)
    }

    @Test
    fun `fromMap ignores legacy broadcastEnabled field`() {
        val map =
            mapOf<String, Any?>(
                "name" to "Crown",
                "coinValue" to 800L,
                "broadcastEnabled" to true,
            )

        val gift = Gift.fromMap(map, "crown")

        // broadcastEnabled is no longer a field on Gift - it's just ignored
        assertEquals("Crown", gift.name)
        assertEquals(800, gift.coinValue)
    }

    @Test
    fun `toMap returns correct fields`() {
        val gift =
            Gift(
                id = "rose",
                name = "Rose",
                coinValue = 8,
                animationUrl = "anim",
                soundUrl = "sound",
                iconUrl = "icon",
                order = 1,
            )

        val map = gift.toMap()

        assertEquals("Rose", map["name"])
        assertEquals(8, map["coinValue"])
        assertEquals("anim", map["animationUrl"])
        assertEquals("sound", map["soundUrl"])
        assertEquals("icon", map["iconUrl"])
        assertEquals(1, map["order"])
        // bracket should NOT be in the map
        assertEquals(false, map.containsKey("bracket"))
        // broadcastEnabled should NOT be in the map
        assertEquals(false, map.containsKey("broadcastEnabled"))
    }

    @Test
    fun `fromMap parses expiresAfterDays`() {
        val map =
            mapOf<String, Any?>(
                "name" to "Sparkler",
                "coinValue" to 50L,
                "expiresAfterDays" to 7L,
            )

        val gift = Gift.fromMap(map, "sparkler")

        assertEquals(7, gift.expiresAfterDays)
    }

    @Test
    fun `fromMap defaults expiresAfterDays to null`() {
        val gift = Gift.fromMap(emptyMap(), "test")

        assertNull(gift.expiresAfterDays)
    }

    @Test
    fun `toMap includes expiresAfterDays when set`() {
        val gift = Gift(id = "sparkler", name = "Sparkler", expiresAfterDays = 7)

        val map = gift.toMap()

        assertEquals(7, map["expiresAfterDays"])
    }

    @Test
    fun `toMap includes null expiresAfterDays for permanent gifts`() {
        val gift = Gift(id = "rose", name = "Rose")

        val map = gift.toMap()

        assertNull(map["expiresAfterDays"])
    }

    @Test
    fun `fromMap parses showOnWheel true`() {
        val map = mapOf<String, Any?>("name" to "Rose", "showOnWheel" to true)
        val gift = Gift.fromMap(map, "rose")
        assertEquals(true, gift.showOnWheel)
    }

    @Test
    fun `fromMap parses showOnWheel false`() {
        val map = mapOf<String, Any?>("name" to "Rose", "showOnWheel" to false)
        val gift = Gift.fromMap(map, "rose")
        assertEquals(false, gift.showOnWheel)
    }

    @Test
    fun `fromMap defaults showOnWheel to true when missing`() {
        val gift = Gift.fromMap(emptyMap(), "test")
        assertEquals(true, gift.showOnWheel)
    }

    @Test
    fun `toMap includes showOnWheel`() {
        val gift = Gift(id = "rose", name = "Rose", showOnWheel = false)
        val map = gift.toMap()
        assertEquals(false, map["showOnWheel"])
    }

    @Test
    fun `toMap defaults showOnWheel to true`() {
        val gift = Gift(id = "rose", name = "Rose")
        val map = gift.toMap()
        assertEquals(true, map["showOnWheel"])
    }
}
