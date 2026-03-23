package com.shyden.shytalk.data.local

import android.content.Context
import io.mockk.every
import io.mockk.mockk
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Before
import org.junit.Test
import java.io.File

class StickerStorageTest {
    private lateinit var tempDir: File
    private lateinit var storage: StickerStorage

    @Before
    fun setup() {
        tempDir = File(System.getProperty("java.io.tmpdir"), "sticker_test_${System.nanoTime()}")
        tempDir.mkdirs()

        val context =
            mockk<Context> {
                every { filesDir } returns tempDir
            }
        storage = StickerStorage(context)
    }

    @After
    fun tearDown() {
        tempDir.deleteRecursively()
    }

    @Test
    fun `getStickers returns empty list when no stickers added`() {
        assertEquals(emptyList<Any>(), storage.getStickers())
    }

    @Test
    fun `addSticker saves file and returns sticker`() {
        val data = byteArrayOf(1, 2, 3, 4)
        val sticker = storage.addSticker("sticker-1", data)

        assertEquals("sticker-1", sticker.id)
        assertTrue(sticker.localPath != null)
        assertTrue(File(sticker.localPath!!).exists())
        assertEquals(4, File(sticker.localPath!!).readBytes().size)
    }

    @Test
    fun `getStickers returns added stickers`() {
        storage.addSticker("s1", byteArrayOf(1))
        storage.addSticker("s2", byteArrayOf(2))

        val stickers = storage.getStickers()
        assertEquals(2, stickers.size)
        assertEquals("s1", stickers[0].id)
        assertEquals("s2", stickers[1].id)
    }

    @Test
    fun `removeSticker deletes file and metadata`() {
        storage.addSticker("s1", byteArrayOf(1))
        storage.addSticker("s2", byteArrayOf(2))
        assertEquals(2, storage.getStickers().size)

        storage.removeSticker("s1")

        val remaining = storage.getStickers()
        assertEquals(1, remaining.size)
        assertEquals("s2", remaining[0].id)
    }

    @Test
    fun `removeSticker also removes from recents`() {
        storage.addSticker("s1", byteArrayOf(1))
        storage.markAsRecent("s1")
        assertEquals(1, storage.getRecentStickers().size)

        storage.removeSticker("s1")
        assertEquals(0, storage.getRecentStickers().size)
    }

    @Test
    fun `getRecentStickers returns empty when no recents`() {
        storage.addSticker("s1", byteArrayOf(1))
        assertEquals(emptyList<Any>(), storage.getRecentStickers())
    }

    @Test
    fun `markAsRecent adds sticker to recents`() {
        storage.addSticker("s1", byteArrayOf(1))
        storage.markAsRecent("s1")

        val recents = storage.getRecentStickers()
        assertEquals(1, recents.size)
        assertEquals("s1", recents[0].id)
    }

    @Test
    fun `markAsRecent moves duplicate to front`() {
        storage.addSticker("s1", byteArrayOf(1))
        storage.addSticker("s2", byteArrayOf(2))
        storage.markAsRecent("s1")
        storage.markAsRecent("s2")
        storage.markAsRecent("s1") // Move s1 back to front

        val recents = storage.getRecentStickers()
        assertEquals(2, recents.size)
        assertEquals("s1", recents[0].id)
        assertEquals("s2", recents[1].id)
    }

    @Test
    fun `markAsRecent limits to 20 entries`() {
        for (i in 1..25) {
            storage.addSticker("s$i", byteArrayOf(i.toByte()))
            storage.markAsRecent("s$i")
        }

        val recents = storage.getRecentStickers()
        assertTrue(recents.size <= 20)
    }

    @Test
    fun `removeSticker for non-existent id does not crash`() {
        storage.removeSticker("non-existent")
        assertEquals(emptyList<Any>(), storage.getStickers())
    }

    @Test
    fun `getStickers skips entries with deleted files`() {
        val sticker = storage.addSticker("s1", byteArrayOf(1))
        assertEquals(1, storage.getStickers().size)

        // Manually delete the file without going through removeSticker
        File(sticker.localPath!!).delete()
        assertEquals(0, storage.getStickers().size)
    }

    @Test
    fun `addSticker overwrites existing file with same id`() {
        storage.addSticker("s1", byteArrayOf(1, 2))
        storage.addSticker("s1", byteArrayOf(3, 4, 5))

        // The file should be overwritten
        val stickers = storage.getStickers()
        // Note: metadata will have two entries with same ID, but both point to same file
        val fileContent = stickers.last().localPath?.let { File(it).readBytes() }
        assertEquals(3, fileContent?.size)
    }

    @Test
    fun `addSticker saves GIF with gif extension`() {
        // GIF magic bytes: GIF8
        val gifData = byteArrayOf(0x47, 0x49, 0x46, 0x38, 0x39, 0x61, 1, 2)
        val sticker = storage.addSticker("gif1", gifData)
        assertTrue(sticker.localPath!!.endsWith(".gif"))
        assertTrue(File(sticker.localPath!!).exists())
    }

    @Test
    fun `addSticker saves WebP with webp extension`() {
        // WebP magic: RIFF....WEBP
        val webpData =
            byteArrayOf(
                0x52,
                0x49,
                0x46,
                0x46, // RIFF
                0x00,
                0x00,
                0x00,
                0x00, // size
                0x57,
                0x45,
                0x42,
                0x50, // WEBP
                1,
                2,
                3,
                4,
            )
        val sticker = storage.addSticker("webp1", webpData)
        assertTrue(sticker.localPath!!.endsWith(".webp"))
    }

    @Test
    fun `addSticker saves PNG with png extension`() {
        // PNG magic bytes
        val pngData = byteArrayOf(0x89.toByte(), 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A)
        val sticker = storage.addSticker("png1", pngData)
        assertTrue(sticker.localPath!!.endsWith(".png"))
    }

    @Test
    fun `addSticker saves unknown format as jpg`() {
        val unknownData = byteArrayOf(0xFF.toByte(), 0xD8.toByte(), 0xFF.toByte(), 0xE0.toByte())
        val sticker = storage.addSticker("jpg1", unknownData)
        assertTrue(sticker.localPath!!.endsWith(".jpg"))
    }

    @Test
    fun `removeSticker works with non-jpg extensions`() {
        val gifData = byteArrayOf(0x47, 0x49, 0x46, 0x38, 0x39, 0x61)
        storage.addSticker("gif1", gifData)
        assertEquals(1, storage.getStickers().size)

        storage.removeSticker("gif1")
        assertEquals(0, storage.getStickers().size)
    }

    @Test
    fun `readStickerBytes returns correct data`() {
        val data = byteArrayOf(10, 20, 30, 40, 50)
        storage.addSticker("s1", data)

        val readBack = storage.readStickerBytes("s1")
        assertTrue(readBack != null)
        assertTrue(data.contentEquals(readBack!!))
    }

    @Test
    fun `readStickerBytes returns null for non-existent sticker`() {
        val result = storage.readStickerBytes("non-existent")
        assertEquals(null, result)
    }

    // ── URL storage (3-field index format) ──

    @Test
    fun `addSticker starts with empty URL`() {
        val sticker = storage.addSticker("s1", byteArrayOf(1, 2, 3))
        assertEquals("", sticker.url)

        val loaded = storage.getStickers()
        assertEquals(1, loaded.size)
        assertEquals("", loaded[0].url)
    }

    @Test
    fun `updateStickerUrl stores URL and getStickers returns it`() {
        storage.addSticker("s1", byteArrayOf(1, 2, 3))
        storage.updateStickerUrl("s1", "https://example.com/sticker.png")

        val stickers = storage.getStickers()
        assertEquals(1, stickers.size)
        assertEquals("https://example.com/sticker.png", stickers[0].url)
    }

    @Test
    fun `updateStickerUrl for non-existent id does not crash`() {
        storage.addSticker("s1", byteArrayOf(1))
        storage.updateStickerUrl("non-existent", "https://example.com/nope.png")

        val stickers = storage.getStickers()
        assertEquals(1, stickers.size)
        assertEquals("", stickers[0].url)
    }

    @Test
    fun `updateStickerUrl overwrites previous URL`() {
        storage.addSticker("s1", byteArrayOf(1))
        storage.updateStickerUrl("s1", "https://old.com/a.png")
        storage.updateStickerUrl("s1", "https://new.com/b.png")

        val stickers = storage.getStickers()
        assertEquals("https://new.com/b.png", stickers[0].url)
    }

    @Test
    fun `updateStickerUrl preserves other stickers`() {
        storage.addSticker("s1", byteArrayOf(1))
        storage.addSticker("s2", byteArrayOf(2))
        storage.updateStickerUrl("s1", "https://example.com/s1.png")

        val stickers = storage.getStickers()
        assertEquals(2, stickers.size)
        assertEquals("https://example.com/s1.png", stickers[0].url)
        assertEquals("", stickers[1].url)
    }

    @Test
    fun `backward compatible index parsing - old 2-field format`() {
        // Manually write old-style index file (id|path — no URL field)
        val stickerFile = File(tempDir, "stickers/old1.jpg")
        File(tempDir, "stickers").mkdirs()
        stickerFile.writeBytes(byteArrayOf(1, 2, 3))
        val indexFile = File(tempDir, "stickers/index.txt")
        indexFile.writeText("old1|${stickerFile.absolutePath}")

        val stickers = storage.getStickers()
        assertEquals(1, stickers.size)
        assertEquals("old1", stickers[0].id)
        assertEquals("", stickers[0].url) // empty URL for old format
    }

    @Test
    fun `backward compatible - updateStickerUrl migrates 2-field to 3-field`() {
        // Write old-style 2-field index
        val stickerFile = File(tempDir, "stickers/old1.jpg")
        File(tempDir, "stickers").mkdirs()
        stickerFile.writeBytes(byteArrayOf(1, 2, 3))
        val indexFile = File(tempDir, "stickers/index.txt")
        indexFile.writeText("old1|${stickerFile.absolutePath}")

        // Update URL on old entry
        storage.updateStickerUrl("old1", "https://migrated.com/old1.png")

        val stickers = storage.getStickers()
        assertEquals(1, stickers.size)
        assertEquals("https://migrated.com/old1.png", stickers[0].url)
    }

    @Test
    fun `moveSticker preserves URL fields`() {
        storage.addSticker("s1", byteArrayOf(1))
        storage.addSticker("s2", byteArrayOf(2))
        storage.updateStickerUrl("s2", "https://example.com/s2.png")

        storage.moveSticker("s2", 0) // Move s2 to front

        val stickers = storage.getStickers()
        assertEquals(2, stickers.size)
        assertEquals("s2", stickers[0].id)
        assertEquals("https://example.com/s2.png", stickers[0].url)
        assertEquals("s1", stickers[1].id)
        assertEquals("", stickers[1].url)
    }
}
