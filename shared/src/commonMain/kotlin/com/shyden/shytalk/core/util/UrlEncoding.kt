package com.shyden.shytalk.core.util

/**
 * Percent-encode a string for safe inclusion as a URL query-component value
 * (the right-hand side of `?key=value`). Dependency-free + multiplatform so the
 * Android (`WorkerApiClient`) and iOS (`IosApiClient`) repositories build the
 * `GET /api/users/search?q=...` URL identically (SHY-0137).
 *
 * Encodes every byte of the UTF-8 representation that is not in the RFC 3986
 * "unreserved" set (`A–Z a–z 0–9 - _ . ~`). Space becomes `%20` (NOT `+`) so
 * Express's `req.query` parser decodes it back to a literal space. This matches
 * the behaviour of JavaScript's `encodeURIComponent` for the subset of
 * characters a display-name search can contain.
 */
fun encodeUrlQueryComponent(value: String): String {
    val unreserved = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_.~"
    val bytes = value.encodeToByteArray()
    return buildString(bytes.size) {
        for (byte in bytes) {
            val intVal = byte.toInt() and 0xFF
            val char = intVal.toChar()
            if (char in unreserved) {
                append(char)
            } else {
                append('%')
                append(HEX_DIGITS[intVal shr 4])
                append(HEX_DIGITS[intVal and 0x0F])
            }
        }
    }
}

private const val HEX_DIGITS = "0123456789ABCDEF"
