package com.shyden.shytalk.data.repository

import android.content.Context
import com.shyden.shytalk.core.model.FunFact
import io.mockk.every
import io.mockk.mockk
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Before
import org.junit.Test
import java.io.File

class FunFactRepositoryImplTest {
    private lateinit var tempDir: File
    private lateinit var context: Context

    @Before
    fun setup() {
        tempDir = File(System.getProperty("java.io.tmpdir"), "funfact_test_${System.nanoTime()}")
        tempDir.mkdirs()
        context =
            mockk<Context> {
                every { filesDir } returns tempDir
            }
    }

    @After
    fun tearDown() {
        tempDir.deleteRecursively()
    }

    @Test
    fun `getCachedFacts returns empty list when no cache file`() {
        val repo = FunFactRepositoryImpl(mockk(), context)
        assertEquals(emptyList<FunFact>(), repo.getCachedFacts())
    }

    @Test
    fun `getCachedFacts reads from cache file`() {
        // Write a cache file manually
        val cacheFile = File(tempDir, "fun_facts_cache.json")
        cacheFile.writeText(
            """
            [{"id":"f1","text":"Fact 1","category":"language","emoji":"🇯🇵","sourceLanguage":"Japanese"},
             {"id":"f2","text":"Fact 2","category":"culture","emoji":"🇰🇷","sourceLanguage":"Korean"}]
            """.trimIndent(),
        )

        val repo = FunFactRepositoryImpl(mockk(), context)
        val facts = repo.getCachedFacts()

        assertEquals(2, facts.size)
        assertEquals("f1", facts[0].id)
        assertEquals("Fact 1", facts[0].text)
        assertEquals("language", facts[0].category)
        assertEquals("🇯🇵", facts[0].emoji)
        assertEquals("Japanese", facts[0].sourceLanguage)
        assertEquals("f2", facts[1].id)
    }

    @Test
    fun `getCachedFacts returns empty list on malformed JSON`() {
        val cacheFile = File(tempDir, "fun_facts_cache.json")
        cacheFile.writeText("not valid json")

        val repo = FunFactRepositoryImpl(mockk(), context)
        assertEquals(emptyList<FunFact>(), repo.getCachedFacts())
    }

    @Test
    fun `getCachedFacts defaults missing fields`() {
        val cacheFile = File(tempDir, "fun_facts_cache.json")
        cacheFile.writeText("""[{"id":"f1","text":"Minimal fact"}]""")

        val repo = FunFactRepositoryImpl(mockk(), context)
        val facts = repo.getCachedFacts()

        assertEquals(1, facts.size)
        assertEquals("trivia", facts[0].category)
        assertEquals("", facts[0].emoji)
        assertEquals("", facts[0].sourceLanguage)
    }
}
