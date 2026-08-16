package com.shyden.shytalk.core.util

/**
 * Percent-encodes a value for use as a URL **query-string component**.
 *
 * One shared definition on purpose. The two platforms had drifted onto
 * different encoders for the same call — Android's `URLEncoder.encode(v,
 * "UTF-8")` and Ktor's `encodeURLQueryComponent()` — and the Ktor default
 * (`encodeFull = false`) leaves the entire `URL_PROTOCOL_PART` set alone.
 * Measured on ktor-http 3.5.2:
 *
 * ```
 * input            : dev&id=x#frag +é
 * ktor default     : dev&id=x#frag%20+%C3%A9      ← & = # + all raw
 * ktor encodeFull  : dev%26id%3Dx%23frag%20%2B%C3%A9
 * ```
 *
 * So a `deviceId` containing `&` split the parameter and one containing `#`
 * truncated at the fragment — the server would answer about a DIFFERENT
 * device and still return 200. Server-side validation cannot see it, because
 * the mangled value that arrives is perfectly well-formed. A silent evasion
 * primitive, and it existed on exactly one platform, which is the shape a
 * per-platform fix produces.
 *
 * RFC 3986 §2.3 unreserved set is kept literal (`A-Z a-z 0-9 - . _ ~`) and
 * everything else is percent-encoded from its UTF-8 bytes. Deliberately
 * stricter than "what a query string tolerates": over-encoding is always
 * decoded correctly by the server, while under-encoding is the bug above.
 *
 * Note `+` is encoded as `%2B`, never left literal — a literal `+` is decoded
 * as a space by `application/x-www-form-urlencoded` readers, which is a
 * different value arriving than the one sent.
 */
fun encodeUrlQueryComponent(value: String): String {
    val out = StringBuilder(value.length)
    for (byte in value.encodeToByteArray()) {
        val ch = byte.toInt().toChar()
        if (ch in 'A'..'Z' || ch in 'a'..'z' || ch in '0'..'9' || ch in "-._~") {
            out.append(ch)
        } else {
            // `and 0xFF` because Kotlin's Byte is signed: a UTF-8 continuation
            // byte such as 0xA9 arrives as -87, and formatting that directly
            // would emit "%-57" rather than "%A9".
            val v = byte.toInt() and 0xFF
            out.append('%')
            out.append(HEX[v shr 4])
            out.append(HEX[v and 0x0F])
        }
    }
    return out.toString()
}

private const val HEX = "0123456789ABCDEF"
