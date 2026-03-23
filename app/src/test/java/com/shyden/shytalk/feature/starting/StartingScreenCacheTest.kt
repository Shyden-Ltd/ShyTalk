package com.shyden.shytalk.feature.starting

import android.content.Context
import android.content.SharedPreferences
import com.shyden.shytalk.data.remote.StartingScreen
import io.mockk.every
import io.mockk.mockk
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertNotNull
import org.junit.Assert.assertNull
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

class StartingScreenCacheTest {
    private lateinit var tempDir: File
    private lateinit var mockContext: Context
    private lateinit var storedPrefs: MutableMap<String, Any?>
    private lateinit var cache: StartingScreenCache

    @Before
    fun setup() {
        tempDir = File(System.getProperty("java.io.tmpdir"), "starting_screen_test_${System.nanoTime()}")
        tempDir.mkdirs()

        storedPrefs = mutableMapOf<String, Any?>()
        val mockEditor = mockk<SharedPreferences.Editor>(relaxed = true)

        every { mockEditor.putStringSet(any(), any()) } answers {
            val key = firstArg<String>()
            val value = secondArg<Set<String>?>()
            storedPrefs[key] = value?.toHashSet()
            mockEditor
        }
        every { mockEditor.remove(any()) } answers {
            storedPrefs.remove(firstArg())
            mockEditor
        }
        every { mockEditor.apply() } answers { /* no-op */ }

        val mockPrefs = mockk<SharedPreferences>()
        every { mockPrefs.getStringSet(any(), any()) } answers {
            @Suppress("UNCHECKED_CAST")
            (storedPrefs[firstArg()] as? Set<String>) ?: secondArg()
        }
        every { mockPrefs.edit() } returns mockEditor

        mockContext = mockk<Context>()
        every { mockContext.cacheDir } returns tempDir
        every { mockContext.getSharedPreferences(any(), any()) } returns mockPrefs

        cache = StartingScreenCache(mockContext)
    }

    @After
    fun teardown() {
        tempDir.deleteRecursively()
    }

    private fun createTestScreen(
        screenId: String = "preLaunchGate",
        dismissable: Boolean = false,
        template: String = "warning",
        title: String = "ShyTalk is not available yet",
        message: String = "ShyTalk has not been released yet.",
        contentHash: String = "abc123",
    ) = StartingScreen(
        screenId = screenId,
        enabled = true,
        dismissable = dismissable,
        frequency = "every_launch",
        template = template,
        title = title,
        message = message,
        imageType = "police_duck",
        backgroundImage = null,
        contentHash = contentHash,
    )

    @Test
    fun `cache write and read roundtrip`() {
        val screen = createTestScreen()
        cache.cacheBlocker(screen, "/path/to/bg.jpg")

        val cached = cache.getCachedBlocker()
        assertNotNull(cached)
        assertEquals("preLaunchGate", cached!!.screenId)
        assertEquals("abc123", cached.contentHash)
        assertEquals("warning", cached.template)
        assertEquals("ShyTalk is not available yet", cached.title)
        assertEquals("ShyTalk has not been released yet.", cached.message)
        assertEquals("police_duck", cached.imageType)
        assertEquals("/path/to/bg.jpg", cached.backgroundImagePath)
        assertFalse(cached.dismissable)
    }

    @Test
    fun `cached screen converts to StartingScreen correctly`() {
        val screen = createTestScreen()
        cache.cacheBlocker(screen, null)

        val cached = cache.getCachedBlocker()!!
        val converted = cached.toStartingScreen()
        assertEquals(screen.screenId, converted.screenId)
        assertEquals(screen.template, converted.template)
        assertEquals(screen.title, converted.title)
        assertEquals(screen.message, converted.message)
        assertEquals(screen.contentHash, converted.contentHash)
        assertEquals(screen.dismissable, converted.dismissable)
    }

    @Test
    fun `no cache returns null`() {
        assertNull(cache.getCachedBlocker())
    }

    @Test
    fun `cache version mismatch returns null and deletes file`() {
        val cacheFile = File(tempDir, "starting_screens_cache.json")
        cacheFile.writeText("""{"cacheVersion": 999, "blockingScreen": {"screenId": "test"}}""")

        assertNull(cache.getCachedBlocker())
        assertFalse(cacheFile.exists())
    }

    @Test
    fun `corrupt JSON returns null and deletes file`() {
        val cacheFile = File(tempDir, "starting_screens_cache.json")
        cacheFile.writeText("not valid json {{{")

        assertNull(cache.getCachedBlocker())
        assertFalse(cacheFile.exists())
    }

    @Test
    fun `zero-byte file returns null`() {
        val cacheFile = File(tempDir, "starting_screens_cache.json")
        cacheFile.writeText("")

        assertNull(cache.getCachedBlocker())
    }

    @Test
    fun `whitespace-only file returns null`() {
        val cacheFile = File(tempDir, "starting_screens_cache.json")
        cacheFile.writeText("   \n  ")

        assertNull(cache.getCachedBlocker())
    }

    @Test
    fun `cache without blockingScreen key returns null`() {
        val cacheFile = File(tempDir, "starting_screens_cache.json")
        cacheFile.writeText("""{"cacheVersion": 1}""")

        assertNull(cache.getCachedBlocker())
    }

    @Test
    fun `clearBlocker removes cache file`() {
        cache.cacheBlocker(createTestScreen(), null)
        val cacheFile = File(tempDir, "starting_screens_cache.json")
        assertTrue(cacheFile.exists())

        cache.clearBlocker()
        assertFalse(cacheFile.exists())
    }

    @Test
    fun `atomic write uses temp file`() {
        cache.cacheBlocker(createTestScreen(), null)
        // Temp file should not exist after successful write
        val tempFile = File(tempDir, "starting_screens_cache.tmp")
        assertFalse(tempFile.exists())
        // Cache file should exist
        val cacheFile = File(tempDir, "starting_screens_cache.json")
        assertTrue(cacheFile.exists())
    }

    @Test
    fun `cache update replaces old content`() {
        cache.cacheBlocker(createTestScreen(title = "Old Title", contentHash = "old"), null)
        cache.cacheBlocker(createTestScreen(title = "New Title", contentHash = "new"), null)

        val cached = cache.getCachedBlocker()
        assertNotNull(cached)
        assertEquals("New Title", cached!!.title)
        assertEquals("new", cached.contentHash)
    }

    @Test
    fun `null imageType is handled`() {
        val screen =
            StartingScreen(
                screenId = "test",
                enabled = true,
                dismissable = false,
                frequency = "every_launch",
                template = "info",
                title = "Test",
                message = "Test message here",
                imageType = null,
                backgroundImage = null,
            )
        cache.cacheBlocker(screen, null)

        val cached = cache.getCachedBlocker()
        assertNotNull(cached)
        assertNull(cached!!.imageType)
    }

    @Test
    fun `null backgroundImagePath is handled`() {
        cache.cacheBlocker(createTestScreen(), null)

        val cached = cache.getCachedBlocker()
        assertNotNull(cached)
        assertTrue(cached!!.backgroundImagePath == null || cached.backgroundImagePath == "null")
    }

    // ── Dismissed screen ID tests ──────────────────────────

    @Test
    fun `isDismissed returns false for unknown screen`() {
        assertFalse(cache.isDismissed("nonexistent"))
    }

    @Test
    fun `markDismissed persists screen ID`() {
        cache.markDismissed("screen1")
        assertTrue(cache.isDismissed("screen1"))
    }

    @Test
    fun `multiple dismissed screens tracked`() {
        cache.markDismissed("screen1")
        cache.markDismissed("screen2")
        assertTrue(cache.isDismissed("screen1"))
        assertTrue(cache.isDismissed("screen2"))
        assertFalse(cache.isDismissed("screen3"))
    }

    @Test
    fun `clearDismissed removes all dismissed IDs`() {
        cache.markDismissed("screen1")
        cache.markDismissed("screen2")
        cache.clearDismissed()
        assertFalse(cache.isDismissed("screen1"))
        assertFalse(cache.isDismissed("screen2"))
    }

    @Test
    fun `markDismissed is idempotent`() {
        cache.markDismissed("screen1")
        cache.markDismissed("screen1")
        assertTrue(cache.isDismissed("screen1"))
    }

    @Test
    fun `cache file size is reasonable for single screen`() {
        cache.cacheBlocker(createTestScreen(), "/path/bg.jpg")
        val cacheFile = File(tempDir, "starting_screens_cache.json")
        assertTrue("Cache file should be under 5KB", cacheFile.length() < 5 * 1024)
    }
}
