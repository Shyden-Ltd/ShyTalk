package com.shyden.shytalk.core.model

import com.google.firebase.Timestamp
import org.junit.Assert.assertEquals
import org.junit.Test
import java.util.Date

class MessageEditFromMapTest {
    private val tsMillis = 1_000_000_000L
    private val ts = Timestamp(Date(tsMillis))

    @Test
    fun `fromMap parses complete valid map`() {
        val map =
            mapOf<String, Any?>(
                "previousText" to "Old text",
                "editedAt" to ts,
            )
        val edit = MessageEdit.fromMap(map, "edit-1")

        assertEquals("edit-1", edit.editId)
        assertEquals("Old text", edit.previousText)
        assertEquals(tsMillis, edit.editedAt)
    }

    @Test
    fun `fromMap handles empty map with defaults`() {
        val edit = MessageEdit.fromMap(emptyMap(), "edit-1")

        assertEquals("edit-1", edit.editId)
        assertEquals("", edit.previousText)
    }

    @Test
    fun `fromMap of toMap round-trip`() {
        val original =
            MessageEdit(
                editId = "edit-1",
                previousText = "Original content",
                editedAt = tsMillis,
            )
        val roundtripped = MessageEdit.fromMap(original.toMap(), "edit-1")
        assertEquals(original, roundtripped)
    }

    @Test
    fun `fromMap handles previousText null`() {
        val map = mapOf<String, Any?>("previousText" to null)
        val edit = MessageEdit.fromMap(map, "edit-1")
        assertEquals("", edit.previousText)
    }
}
