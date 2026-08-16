package com.shyden.shytalk.core.util

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * SHY-0143 — the shared query-component encoder.
 *
 * This exists because the two platforms had drifted onto different encoders
 * for the SAME call. Android used `URLEncoder.encode`, iOS used Ktor's
 * `encodeURLQueryComponent()` with default arguments — and that default leaves
 * `&`, `=`, `#` and `+` literal. A `deviceId` carrying `&` therefore split the
 * ban-status query and one carrying `#` truncated at the fragment, so the
 * server answered about a DIFFERENT device and still returned 200.
 *
 * The Android test for that encoding passed while iOS was broken, which is the
 * shape a per-platform fix produces. Being commonTest, this one holds both.
 */
class UrlEncodingTest {
    @Test
    fun `the characters that split or truncate a query are encoded`() {
        // Each of these changes which request the SERVER sees, not merely how
        // it looks: `&` starts a new parameter, `=` ends the name, `#` starts
        // the fragment (which is never sent), `?` starts the query.
        mapOf(
            "&" to "%26",
            "=" to "%3D",
            "#" to "%23",
            "?" to "%3F",
            "/" to "%2F",
            " " to "%20",
        ).forEach { (raw, encoded) ->
            assertEquals(encoded, encodeUrlQueryComponent(raw), "'$raw' must not survive literally")
        }
    }

    @Test
    fun `plus is encoded, never left literal`() {
        // A literal `+` is decoded as a SPACE by form-urlencoded readers, so
        // leaving it through means a different value arrives than was sent.
        assertEquals("%2B", encodeUrlQueryComponent("+"))
    }

    @Test
    fun `the RFC 3986 unreserved set passes through untouched`() {
        // Over-encoding is harmless; this just keeps ordinary ids readable in
        // logs and avoids pointless expansion.
        val unreserved = "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789-._~"
        assertEquals(unreserved, encodeUrlQueryComponent(unreserved))
    }

    @Test
    fun `a realistic deviceId is unchanged`() {
        // The common case must not become unreadable.
        assertEquals("a1b2c3d4e5f6", encodeUrlQueryComponent("a1b2c3d4e5f6"))
        assertEquals("dev-1_2.3~4", encodeUrlQueryComponent("dev-1_2.3~4"))
    }

    @Test
    fun `multi-byte UTF-8 is encoded byte by byte, with upper-case hex`() {
        // `é` is two bytes (C3 A9). Kotlin's Byte is SIGNED, so 0xA9 arrives as
        // -87 — formatting it without masking would emit "%-57".
        assertEquals("%C3%A9", encodeUrlQueryComponent("é"))
        // An emoji is four bytes, which also exercises the surrogate pair.
        assertEquals("%F0%9F%98%80", encodeUrlQueryComponent("😀"))
    }

    @Test
    fun `an empty string encodes to an empty string`() {
        assertEquals("", encodeUrlQueryComponent(""))
    }

    @Test
    fun `a hostile deviceId cannot smuggle a second parameter`() {
        // The actual attack: without encoding, the server reads
        // `deviceId=innocent` and never sees `evil`.
        val hostile = "innocent&deviceId=evil"
        val query = "deviceId=" + encodeUrlQueryComponent(hostile)

        assertEquals(1, query.split("&").size, "the value must not introduce a second parameter")
        assertFalse(query.contains("&deviceId=evil"))
        assertTrue(query.contains("%26"))
    }

    @Test
    fun `a hostile deviceId cannot truncate the request at a fragment`() {
        // `#` and everything after it is never transmitted, so an unencoded
        // one silently shortens the value the server matches on.
        val hostile = "innocent#ignored"
        val query = "deviceId=" + encodeUrlQueryComponent(hostile)

        assertFalse(query.contains("#"), "a raw '#' would drop everything after it in transit")
        assertTrue(query.endsWith("%23ignored"))
    }

    @Test
    fun `every byte value round-trips through a decoder`() {
        // Exhaustive over the ASCII range plus a sample of higher code points:
        // whatever is emitted must decode back to exactly what went in.
        val samples = (0..127).map { it.toChar().toString() } + listOf("é", "日本語", "😀", "a b&c=d#e")
        samples.forEach { original ->
            assertEquals(original, decode(encodeUrlQueryComponent(original)), "round-trip failed for ${original.map { it.code }}")
        }
    }

    /** A deliberately independent decoder — reusing the encoder would prove nothing. */
    private fun decode(encoded: String): String {
        val bytes = mutableListOf<Byte>()
        var i = 0
        while (i < encoded.length) {
            val c = encoded[i]
            if (c == '%') {
                bytes.add(encoded.substring(i + 1, i + 3).toInt(16).toByte())
                i += 3
            } else {
                bytes.add(c.code.toByte())
                i += 1
            }
        }
        return bytes.toByteArray().decodeToString()
    }
}
