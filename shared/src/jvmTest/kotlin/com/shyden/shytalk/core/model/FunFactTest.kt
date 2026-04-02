package com.shyden.shytalk.core.model

import kotlin.test.Test
import kotlin.test.assertEquals

class FunFactTest {
    // ── fromMap basic ───────────────────────────────────────────────

    @Test
    fun `fromMap parses all fields`() {
        val map =
            mapOf<String, Any?>(
                "text" to "Honey never spoils.",
                "category" to "science",
                "emoji" to "\uD83C\uDF6F",
                "sourceLanguage" to "en",
            )

        val fact = FunFact.fromMap(map, "fact-1")

        assertEquals("fact-1", fact.id)
        assertEquals("Honey never spoils.", fact.text)
        assertEquals("science", fact.category)
        assertEquals("\uD83C\uDF6F", fact.emoji)
        assertEquals("en", fact.sourceLanguage)
    }

    @Test
    fun `fromMap defaults for empty map`() {
        val fact = FunFact.fromMap(emptyMap(), "fact-2")

        assertEquals("fact-2", fact.id)
        assertEquals("", fact.text)
        assertEquals("trivia", fact.category)
        assertEquals("", fact.emoji)
        assertEquals("", fact.sourceLanguage)
    }

    // ── Snake_case fallback ─────────────────────────────────────────

    @Test
    fun `fromMap uses snake_case source_language fallback`() {
        val map = mapOf<String, Any?>("source_language" to "ko")
        val fact = FunFact.fromMap(map, "fact-3")
        assertEquals("ko", fact.sourceLanguage)
    }

    @Test
    fun `fromMap prefers camelCase over snake_case for sourceLanguage`() {
        val map =
            mapOf<String, Any?>(
                "sourceLanguage" to "en",
                "source_language" to "ko",
            )
        val fact = FunFact.fromMap(map, "fact-4")
        assertEquals("en", fact.sourceLanguage)
    }

    // ── Null field handling ─────────────────────────────────────────

    @Test
    fun `fromMap handles null text`() {
        val map = mapOf<String, Any?>("text" to null)
        val fact = FunFact.fromMap(map, "fact-5")
        assertEquals("", fact.text)
    }

    @Test
    fun `fromMap handles null category defaults to trivia`() {
        val map = mapOf<String, Any?>("category" to null)
        val fact = FunFact.fromMap(map, "fact-6")
        assertEquals("trivia", fact.category)
    }

    @Test
    fun `fromMap handles null emoji`() {
        val map = mapOf<String, Any?>("emoji" to null)
        val fact = FunFact.fromMap(map, "fact-7")
        assertEquals("", fact.emoji)
    }

    // ── ID is always from parameter ─────────────────────────────────

    @Test
    fun `fromMap uses id parameter not map`() {
        val map = mapOf<String, Any?>("id" to "wrong-id", "text" to "fact")
        val fact = FunFact.fromMap(map, "correct-id")
        assertEquals("correct-id", fact.id)
    }
}
