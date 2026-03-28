package com.shyden.shytalk.core.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNotNull
import kotlin.test.assertNull
import kotlin.test.assertTrue

class CountryDataTest {
    // ── flagEmojiForCode ────────────────────────────────────────────

    @Test
    fun `flagEmojiForCode returns non-empty for valid 2-letter code`() {
        val flag = flagEmojiForCode("US")
        assertTrue(flag.isNotEmpty())
    }

    @Test
    fun `flagEmojiForCode produces different results for different codes`() {
        val usFlag = flagEmojiForCode("US")
        val gbFlag = flagEmojiForCode("GB")
        assertTrue(usFlag != gbFlag, "US and GB flags should be different")
    }

    @Test
    fun `flagEmojiForCode is case insensitive`() {
        val upper = flagEmojiForCode("US")
        val lower = flagEmojiForCode("us")
        assertEquals(upper, lower)
    }

    @Test
    fun `flagEmojiForCode returns empty for empty string`() {
        assertEquals("", flagEmojiForCode(""))
    }

    @Test
    fun `flagEmojiForCode returns empty for single character`() {
        assertEquals("", flagEmojiForCode("U"))
    }

    @Test
    fun `flagEmojiForCode returns empty for 3-character code`() {
        assertEquals("", flagEmojiForCode("USA"))
    }

    @Test
    fun `flagEmojiForCode produces consistent results`() {
        val first = flagEmojiForCode("JP")
        val second = flagEmojiForCode("JP")
        assertEquals(first, second)
    }

    @Test
    fun `flagEmojiForCode handles mixed case`() {
        val flag = flagEmojiForCode("gB")
        assertEquals(flagEmojiForCode("GB"), flag)
    }

    // ── countryNameForCode ──────────────────────────────────────────

    @Test
    fun `countryNameForCode returns United States for US`() {
        assertEquals("United States", countryNameForCode("US"))
    }

    @Test
    fun `countryNameForCode returns United Kingdom for GB`() {
        assertEquals("United Kingdom", countryNameForCode("GB"))
    }

    @Test
    fun `countryNameForCode returns Japan for JP`() {
        assertEquals("Japan", countryNameForCode("JP"))
    }

    @Test
    fun `countryNameForCode is case insensitive`() {
        assertEquals("Germany", countryNameForCode("de"))
        assertEquals("Germany", countryNameForCode("DE"))
        assertEquals("Germany", countryNameForCode("De"))
    }

    @Test
    fun `countryNameForCode returns null for unknown code`() {
        assertNull(countryNameForCode("XX"))
    }

    @Test
    fun `countryNameForCode returns null for empty string`() {
        assertNull(countryNameForCode(""))
    }

    @Test
    fun `countryNameForCode returns null for invalid code`() {
        assertNull(countryNameForCode("INVALID"))
    }

    // ── countries list ──────────────────────────────────────────────

    @Test
    fun `countries list is not empty`() {
        assertTrue(countries.isNotEmpty())
    }

    @Test
    fun `countries list contains expected major countries`() {
        val codes = countries.map { it.code }.toSet()
        assertTrue("US" in codes, "Missing United States")
        assertTrue("GB" in codes, "Missing United Kingdom")
        assertTrue("CN" in codes, "Missing China")
        assertTrue("JP" in codes, "Missing Japan")
        assertTrue("FR" in codes, "Missing France")
        assertTrue("DE" in codes, "Missing Germany")
        assertTrue("BR" in codes, "Missing Brazil")
        assertTrue("IN" in codes, "Missing India")
        assertTrue("AU" in codes, "Missing Australia")
        assertTrue("CA" in codes, "Missing Canada")
    }

    @Test
    fun `countries all have 2-letter codes`() {
        countries.forEach { country ->
            assertEquals(2, country.code.length, "Country ${country.name} has invalid code length: ${country.code}")
        }
    }

    @Test
    fun `countries all have non-empty names`() {
        countries.forEach { country ->
            assertTrue(country.name.isNotEmpty(), "Country with code ${country.code} has empty name")
        }
    }

    @Test
    fun `countries all have non-empty flag emojis`() {
        countries.forEach { country ->
            assertTrue(country.flagEmoji.isNotEmpty(), "Country ${country.name} has empty flag emoji")
        }
    }

    @Test
    fun `countries have unique codes`() {
        val codes = countries.map { it.code }
        assertEquals(codes.size, codes.toSet().size, "Duplicate country codes found")
    }

    @Test
    fun `countries have uppercase codes`() {
        countries.forEach { country ->
            assertEquals(country.code, country.code.uppercase(), "Country ${country.name} has non-uppercase code: ${country.code}")
        }
    }

    @Test
    fun `countries flag emoji matches code`() {
        countries.forEach { country ->
            val expected = flagEmojiForCode(country.code)
            assertEquals(expected, country.flagEmoji, "Flag mismatch for ${country.name} (${country.code})")
        }
    }

    // ── Country data class ──────────────────────────────────────────

    @Test
    fun `Country data class stores properties correctly`() {
        val country = Country("US", "United States", flagEmojiForCode("US"))
        assertEquals("US", country.code)
        assertEquals("United States", country.name)
        assertEquals(flagEmojiForCode("US"), country.flagEmoji)
    }

    @Test
    fun `Country data class equality works`() {
        val a = Country("US", "United States", flagEmojiForCode("US"))
        val b = Country("US", "United States", flagEmojiForCode("US"))
        assertEquals(a, b)
    }

    @Test
    fun `Country copy works`() {
        val original = Country("US", "United States", flagEmojiForCode("US"))
        val copy = original.copy(name = "USA")
        assertEquals("US", copy.code)
        assertEquals("USA", copy.name)
    }

    @Test
    fun `countryNameForCode resolves all countries in list`() {
        countries.forEach { country ->
            val name = countryNameForCode(country.code)
            assertNotNull(name, "countryNameForCode returned null for ${country.code}")
            assertEquals(country.name, name, "Name mismatch for code ${country.code}")
        }
    }
}
