package com.shyden.shytalk.data.local

import android.content.Context
import com.shyden.shytalk.feature.messaging.Sticker
import java.io.File

actual class StickerStorage(
    private val context: Context,
) {
    private val stickersDir: File
        get() = File(context.filesDir, "stickers").also { it.mkdirs() }

    /** Each line: id|localPath|url (url may be empty) */
    private val indexFile: File
        get() = File(stickersDir, "index.txt")

    /** Each line: sticker id (most recent first) */
    private val recentsFile: File
        get() = File(stickersDir, "recents.txt")

    private fun readIndex(): List<Triple<String, String, String>> {
        if (!indexFile.exists()) return emptyList()
        return try {
            indexFile.readLines().mapNotNull { line ->
                val parts = line.split("|", limit = 3)
                if (parts.size >= 2 && parts[0].isNotBlank() && parts[1].isNotBlank()) {
                    Triple(parts[0], parts[1], parts.getOrElse(2) { "" })
                } else {
                    null
                }
            }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun writeIndex(entries: List<Triple<String, String, String>>) {
        indexFile.writeText(entries.joinToString("\n") { "${it.first}|${it.second}|${it.third}" })
    }

    private fun readRecents(): List<String> {
        if (!recentsFile.exists()) return emptyList()
        return try {
            recentsFile.readLines().filter { it.isNotBlank() }
        } catch (_: Exception) {
            emptyList()
        }
    }

    private fun writeRecents(ids: List<String>) {
        recentsFile.writeText(ids.joinToString("\n"))
    }

    actual fun getStickers(): List<Sticker> =
        readIndex().mapNotNull { (id, localPath, url) ->
            if (File(localPath).exists()) {
                Sticker(id = id, url = url, localPath = localPath)
            } else {
                null
            }
        }

    actual fun addSticker(
        id: String,
        imageData: ByteArray,
    ): Sticker {
        val ext = detectImageExtension(imageData)
        val file = File(stickersDir, "$id.$ext")
        file.writeBytes(imageData)

        val entries = readIndex().toMutableList()
        entries.add(Triple(id, file.absolutePath, ""))
        writeIndex(entries)

        return Sticker(id = id, url = "", localPath = file.absolutePath)
    }

    actual fun removeSticker(id: String) {
        val entries = readIndex()
        val entry = entries.find { it.first == id }
        if (entry != null) {
            File(entry.second).delete()
        }

        writeIndex(entries.filter { it.first != id })

        val recents = readRecents().filter { it != id }
        writeRecents(recents)
    }

    actual fun updateStickerUrl(
        id: String,
        url: String,
    ) {
        val entries = readIndex().toMutableList()
        val idx = entries.indexOfFirst { it.first == id }
        if (idx < 0) return
        val old = entries[idx]
        entries[idx] = Triple(old.first, old.second, url)
        writeIndex(entries)
    }

    actual fun moveSticker(
        id: String,
        toIndex: Int,
    ) {
        val entries = readIndex().toMutableList()
        val fromIndex = entries.indexOfFirst { it.first == id }
        if (fromIndex < 0 || fromIndex == toIndex) return
        val entry = entries.removeAt(fromIndex)
        val clampedIndex = toIndex.coerceIn(0, entries.size)
        entries.add(clampedIndex, entry)
        writeIndex(entries)
    }

    actual fun readStickerBytes(id: String): ByteArray? {
        val entry = readIndex().find { it.first == id } ?: return null
        val file = File(entry.second)
        return if (file.exists()) file.readBytes() else null
    }

    private fun detectImageExtension(data: ByteArray): String {
        if (data.size >= 4) {
            // GIF: starts with "GIF8"
            if (data[0] == 0x47.toByte() &&
                data[1] == 0x49.toByte() &&
                data[2] == 0x46.toByte() &&
                data[3] == 0x38.toByte()
            ) {
                return "gif"
            }
            // WebP: starts with "RIFF" and has "WEBP" at offset 8
            if (data.size >= 12 &&
                data[0] == 0x52.toByte() &&
                data[1] == 0x49.toByte() &&
                data[2] == 0x46.toByte() &&
                data[3] == 0x46.toByte() &&
                data[8] == 0x57.toByte() &&
                data[9] == 0x45.toByte() &&
                data[10] == 0x42.toByte() &&
                data[11] == 0x50.toByte()
            ) {
                return "webp"
            }
            // PNG: starts with 0x89 PNG
            if (data[0] == 0x89.toByte() &&
                data[1] == 0x50.toByte() &&
                data[2] == 0x4E.toByte() &&
                data[3] == 0x47.toByte()
            ) {
                return "png"
            }
        }
        return "jpg"
    }

    actual fun getRecentStickers(): List<Sticker> {
        val allStickers = getStickers().associateBy { it.id }
        return readRecents().take(20).mapNotNull { id -> allStickers[id] }
    }

    actual fun markAsRecent(id: String) {
        val existing = readRecents().filter { it != id }
        val updated = listOf(id) + existing
        writeRecents(updated.take(20))
    }
}
