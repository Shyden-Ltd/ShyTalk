package com.shyden.shytalk.core.model

import org.junit.Assert.assertEquals
import org.junit.Test

class FunFactFromMapTest {
    @Test
    fun `fromMap with camelCase keys`() {
        val map =
            mapOf<String, Any?>(
                "text" to "Japanese has 3 writing systems.",
                "category" to "language",
                "emoji" to "\uD83C\uDDEF\uD83C\uDDF5",
                "sourceLanguage" to "Japanese",
            )
        val fact = FunFact.fromMap(map, "f1")
        assertEquals("f1", fact.id)
        assertEquals("Japanese has 3 writing systems.", fact.text)
        assertEquals("language", fact.category)
        assertEquals("\uD83C\uDDEF\uD83C\uDDF5", fact.emoji)
        assertEquals("Japanese", fact.sourceLanguage)
    }

    @Test
    fun `fromMap with snake_case keys`() {
        val map =
            mapOf<String, Any?>(
                "text" to "Finnish has no gender.",
                "category" to "language",
                "emoji" to "\uD83C\uDDEB\uD83C\uDDEE",
                "source_language" to "Finnish",
            )
        val fact = FunFact.fromMap(map, "f2")
        assertEquals("Finnish", fact.sourceLanguage)
    }

    @Test
    fun `fromMap defaults for missing fields`() {
        val map = mapOf<String, Any?>("text" to "Some fact")
        val fact = FunFact.fromMap(map, "f3")
        assertEquals("Some fact", fact.text)
        assertEquals("trivia", fact.category)
        assertEquals("", fact.emoji)
        assertEquals("", fact.sourceLanguage)
    }

    @Test
    fun `fromMap with null values uses defaults`() {
        val map =
            mapOf<String, Any?>(
                "text" to null,
                "category" to null,
                "emoji" to null,
                "sourceLanguage" to null,
            )
        val fact = FunFact.fromMap(map, "f4")
        assertEquals("", fact.text)
        assertEquals("trivia", fact.category)
        assertEquals("", fact.emoji)
        assertEquals("", fact.sourceLanguage)
    }
}
