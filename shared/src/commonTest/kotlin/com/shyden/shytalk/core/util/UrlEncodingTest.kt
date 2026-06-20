package com.shyden.shytalk.core.util

import kotlin.test.Test
import kotlin.test.assertEquals

/**
 * Tests for [encodeUrlQueryComponent] — the multiplatform percent-encoder used
 * to build the `GET /api/users/search?q=...` URL on both Android and iOS
 * (SHY-0137). Verified from commonTest so the contract holds for both targets.
 *
 * The reference behaviour is JavaScript's `encodeURIComponent` for the subset
 * of characters a user-search query can contain — the Express `req.query`
 * parser must decode the output back to the original string.
 */
class UrlEncodingTest {
    @Test
    fun `leaves unreserved characters untouched`() {
        assertEquals(
            "ABCabc123-_.~",
            encodeUrlQueryComponent("ABCabc123-_.~"),
        )
    }

    @Test
    fun `encodes a space as percent-20 not plus`() {
        assertEquals("Bob%20Smith", encodeUrlQueryComponent("Bob Smith"))
    }

    @Test
    fun `encodes query-delimiter characters so they cannot split the url`() {
        assertEquals("a%26b%3Dc%3Fd", encodeUrlQueryComponent("a&b=c?d"))
    }

    @Test
    fun `encodes a numeric uniqueId query verbatim`() {
        // Digits are unreserved — a numeric uniqueId passes through unchanged.
        assertEquals("10000002", encodeUrlQueryComponent("10000002"))
    }

    @Test
    fun `percent-encodes multi-byte utf8 characters per byte`() {
        // "é" is U+00E9 → UTF-8 0xC3 0xA9 → "%C3%A9".
        assertEquals("caf%C3%A9", encodeUrlQueryComponent("café"))
        // "中" is U+4E2D → UTF-8 0xE4 0xB8 0xAD → "%E4%B8%AD".
        assertEquals("%E4%B8%AD", encodeUrlQueryComponent("中"))
    }

    @Test
    fun `percent-encodes a 4-byte utf8 emoji per byte`() {
        // "😀" is U+1F600 → UTF-8 0xF0 0x9F 0x98 0x80 → "%F0%9F%98%80".
        // A 4-byte code point spans a surrogate pair in Kotlin; the encoder
        // must walk the UTF-8 bytes, not the UTF-16 chars.
        assertEquals("%F0%9F%98%80", encodeUrlQueryComponent("😀"))
    }

    @Test
    fun `encodes an empty string to an empty string`() {
        assertEquals("", encodeUrlQueryComponent(""))
    }

    @Test
    fun `uses uppercase hex digits`() {
        // '/' is 0x2F → "%2F" (uppercase F).
        assertEquals("%2F", encodeUrlQueryComponent("/"))
    }
}
