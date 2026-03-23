package com.shyden.shytalk.core.util

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Test

class CountryDataTest {
    @Test
    fun `flagEmojiForCode returns correct emoji for US`() {
        val result = flagEmojiForCode("US")
        // U+1F1FA (regional indicator U) + U+1F1F8 (regional indicator S)
        val expected = String(Character.toChars(0x1F1FA)) + String(Character.toChars(0x1F1F8))
        assertEquals(expected, result)
    }

    @Test
    fun `flagEmojiForCode handles lowercase input`() {
        assertEquals(flagEmojiForCode("US"), flagEmojiForCode("us"))
    }

    @Test
    fun `flagEmojiForCode returns correct emoji for GB`() {
        val result = flagEmojiForCode("GB")
        val expected = String(Character.toChars(0x1F1EC)) + String(Character.toChars(0x1F1E7))
        assertEquals(expected, result)
    }

    @Test
    fun `flagEmojiForCode returns empty for empty string`() {
        assertEquals("", flagEmojiForCode(""))
    }

    @Test
    fun `flagEmojiForCode returns empty for single char`() {
        assertEquals("", flagEmojiForCode("A"))
    }

    @Test
    fun `flagEmojiForCode returns empty for three chars`() {
        assertEquals("", flagEmojiForCode("ABC"))
    }

    @Test
    fun `countryNameForCode returns name for valid code`() {
        assertEquals("United States", countryNameForCode("US"))
    }

    @Test
    fun `countryNameForCode handles lowercase`() {
        assertEquals("United States", countryNameForCode("us"))
    }

    @Test
    fun `countryNameForCode returns null for invalid code`() {
        assertNull(countryNameForCode("XX"))
    }

    @Test
    fun `countryNameForCode returns null for empty string`() {
        assertNull(countryNameForCode(""))
    }

    @Test
    fun `countries list has no duplicate codes`() {
        val codes = countries.map { it.code }
        assertEquals(codes.size, codes.distinct().size)
    }

    @Test
    fun `countries list entries have non-empty fields`() {
        countries.forEach { country ->
            assertTrue("Code empty for ${country.name}", country.code.isNotEmpty())
            assertTrue("Name empty for ${country.code}", country.name.isNotEmpty())
            assertTrue("Flag empty for ${country.code}", country.flagEmoji.isNotEmpty())
        }
    }
}
