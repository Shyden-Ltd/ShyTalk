package com.shyden.shytalk.data.repository

import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertNull

/**
 * SHY-0387 — what the picker returns has to survive the trip to the server.
 *
 * The server's `ATTACHMENT_CONTENT_TYPES` is the authority. A type this accepts
 * that the server does not is an upload that fails after the bytes have gone; a
 * type this rejects that the server would take is a file somebody is told they
 * cannot send when they can.
 */
class AttachmentTypeTest {
    @Test
    fun `every type the server accepts is one the client can send`() {
        // Mirrors ATTACHMENT_CONTENT_TYPES in routes/support-tickets.js.
        val serverAccepts = listOf("image/jpeg", "image/png", "image/webp", "video/mp4", "video/quicktime")

        for (type in serverAccepts) {
            assertEquals(type, AttachmentType.fromContentType(type)?.wireValue, "server accepts $type; client does not")
        }
    }

    @Test
    fun `a type carrying parameters still resolves`() {
        assertEquals(AttachmentType.Jpeg, AttachmentType.fromContentType("image/jpeg; charset=binary"))
    }

    @Test
    fun `an upper-case type still resolves`() {
        assertEquals(AttachmentType.Png, AttachmentType.fromContentType("IMAGE/PNG"))
    }

    @Test
    fun `surrounding whitespace still resolves`() {
        assertEquals(AttachmentType.Mp4, AttachmentType.fromContentType("  video/mp4  "))
    }

    @Test
    fun `a type the server would refuse is refused here first`() {
        assertNull(AttachmentType.fromContentType("application/x-msdownload"))
        assertNull(AttachmentType.fromContentType("application/pdf"))
        assertNull(AttachmentType.fromContentType("text/html"))
    }

    @Test
    fun `an unknown type is refused rather than guessed as an image`() {
        // The Android picker answers application/octet-stream when the resolver
        // cannot say. Guessing image/jpeg there is how a file of the wrong kind
        // reaches the server with a signature that says otherwise.
        assertNull(AttachmentType.fromContentType("application/octet-stream"))
    }

    @Test
    fun `nothing at all is refused`() {
        assertNull(AttachmentType.fromContentType(null))
        assertNull(AttachmentType.fromContentType(""))
    }
}
