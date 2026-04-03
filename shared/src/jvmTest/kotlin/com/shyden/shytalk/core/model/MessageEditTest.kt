package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals

class MessageEditTest {
    // ── fromMap ─────────────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "previousText" to "Hello world",
                "editedAt" to 1705326600000L,
            )

        val edit = MessageEdit.fromMap(map, "edit-1")

        assertEquals("edit-1", edit.editId)
        assertEquals("Hello world", edit.previousText)
        assertEquals(1705326600000L, edit.editedAt)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val edit = MessageEdit.fromMap(emptyMap(), "edit-2")

        assertEquals("edit-2", edit.editId)
        assertEquals("", edit.previousText)
    }

    @Test
    fun `fromMap handles missing previousText`() {
        val map = mapOf<String, Any?>("editedAt" to 1705326600000L)

        val edit = MessageEdit.fromMap(map, "edit-3")

        assertEquals("", edit.previousText)
    }

    @Test
    fun `fromMap handles null previousText`() {
        val map =
            mapOf<String, Any?>(
                "previousText" to null,
                "editedAt" to 1705326600000L,
            )

        val edit = MessageEdit.fromMap(map, "edit-4")

        assertEquals("", edit.previousText)
    }

    @Test
    fun `fromMap handles Int editedAt`() {
        val map =
            mapOf<String, Any?>(
                "previousText" to "Test",
                "editedAt" to 1705326600,
            )

        val edit = MessageEdit.fromMap(map, "edit-5")

        assertEquals(1705326600L, edit.editedAt)
    }

    // ── toMap ───────────────────────────────────────────────────────

    @Test
    fun `toMap serializes all fields`() {
        val edit =
            MessageEdit(
                editId = "edit-1",
                previousText = "Original text",
                editedAt = 1705326600000L,
            )

        val map = edit.toMap()

        assertEquals("Original text", map["previousText"])
        assertEquals(1705326600000L, map["editedAt"])
    }

    @Test
    fun `toMap does not include editId`() {
        val edit =
            MessageEdit(
                editId = "edit-1",
                previousText = "Text",
                editedAt = 1705326600000L,
            )

        val map = edit.toMap()

        assertEquals(false, map.containsKey("editId"))
    }

    // ── Default constructor ─────────────────────────────────────────

    @Test
    fun `default constructor sets empty values`() {
        val edit = MessageEdit()

        assertEquals("", edit.editId)
        assertEquals("", edit.previousText)
        assertEquals(0L, edit.editedAt)
    }

    // ── Round-trip ──────────────────────────────────────────────────

    @Test
    fun `fromMap and toMap round-trip preserves data`() {
        val original =
            MessageEdit(
                editId = "edit-rt",
                previousText = "Round-trip test",
                editedAt = 1705326600000L,
            )

        val restored = MessageEdit.fromMap(original.toMap(), original.editId)

        assertEquals(original.editId, restored.editId)
        assertEquals(original.previousText, restored.previousText)
        assertEquals(original.editedAt, restored.editedAt)
    }
}
