package com.shyden.shytalk.data.local

import com.shyden.shytalk.feature.messaging.Sticker
import kotlinx.cinterop.BetaInteropApi
import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import platform.Foundation.NSData
import platform.Foundation.NSDocumentDirectory
import platform.Foundation.NSFileManager
import platform.Foundation.NSSearchPathForDirectoriesInDomains
import platform.Foundation.NSString
import platform.Foundation.NSUTF8StringEncoding
import platform.Foundation.NSUserDomainMask
import platform.Foundation.create
import platform.Foundation.dataWithContentsOfFile
import platform.Foundation.stringByAppendingPathComponent
import platform.Foundation.writeToFile
import platform.posix.memcpy

@OptIn(BetaInteropApi::class)
private fun String.appendPathComponent(component: String): String = NSString.create(string = this).stringByAppendingPathComponent(component)

@OptIn(ExperimentalForeignApi::class, BetaInteropApi::class)
actual class StickerStorage {
    private val fileManager = NSFileManager.defaultManager
    private val stickersDir: String by lazy {
        val docs =
            NSSearchPathForDirectoriesInDomains(
                NSDocumentDirectory,
                NSUserDomainMask,
                true,
            ).first() as String
        val dir = docs.appendPathComponent("stickers")
        if (!fileManager.fileExistsAtPath(dir)) {
            fileManager.createDirectoryAtPath(dir, true, null, null)
        }
        dir
    }
    private val indexFile: String
        get() = stickersDir.appendPathComponent("index.txt")
    private val recentsFile: String
        get() = stickersDir.appendPathComponent("recents.txt")

    actual fun getStickers(): List<Sticker> =
        readIndex().map { (id, path) ->
            Sticker(id = id, url = "", localPath = path)
        }

    actual fun addSticker(
        id: String,
        imageData: ByteArray,
    ): Sticker {
        val ext = detectImageExtension(imageData)
        val imagePath = stickersDir.appendPathComponent("$id.$ext")
        imageData.usePinned { pinned ->
            val nsData = NSData.create(bytes = pinned.addressOf(0), length = imageData.size.toULong())
            nsData.writeToFile(imagePath, true)
        }
        val sticker = Sticker(id = id, url = "", localPath = imagePath)
        val entries = readIndex().toMutableList()
        entries.add(Pair(id, imagePath))
        writeIndex(entries)
        return sticker
    }

    actual fun removeSticker(id: String) {
        val entries = readIndex()
        val entry = entries.find { it.first == id }
        if (entry != null) {
            fileManager.removeItemAtPath(entry.second, null)
        }
        writeIndex(entries.filter { it.first != id })
        val recents = readLines(recentsFile).filterNot { it == id }
        writeLines(recentsFile, recents)
    }

    actual fun moveSticker(
        id: String,
        toIndex: Int,
    ) {
        val entries = readIndex().toMutableList()
        val idx = entries.indexOfFirst { it.first == id }
        if (idx >= 0 && toIndex in entries.indices) {
            val item = entries.removeAt(idx)
            entries.add(toIndex.coerceIn(0, entries.size), item)
            writeIndex(entries)
        }
    }

    actual fun updateStickerUrl(
        id: String,
        url: String,
    ) {
        val entries =
            readIndex().map { (entryId, path) ->
                if (entryId == id) Pair(entryId, url) else Pair(entryId, path)
            }
        writeIndex(entries)
    }

    actual fun getRecentStickers(): List<Sticker> {
        val recents = readLines(recentsFile)
        val all = getStickers().associateBy { it.id }
        return recents.mapNotNull { all[it] }
    }

    actual fun markAsRecent(id: String) {
        val recents = readLines(recentsFile).toMutableList()
        recents.remove(id)
        recents.add(0, id)
        if (recents.size > 20) recents.subList(20, recents.size).clear()
        writeLines(recentsFile, recents)
    }

    actual fun readStickerBytes(id: String): ByteArray? {
        val entry = readIndex().find { it.first == id } ?: return null
        val data = NSData.dataWithContentsOfFile(entry.second) ?: return null
        return ByteArray(data.length.toInt()).also { bytes ->
            bytes.usePinned { pinned ->
                memcpy(pinned.addressOf(0), data.bytes, data.length)
            }
        }
    }

    private fun readIndex(): List<Pair<String, String>> =
        readLines(indexFile).mapNotNull { line ->
            val parts = line.split("|")
            if (parts.size >= 2) Pair(parts[0], parts[1]) else null
        }

    private fun writeIndex(entries: List<Pair<String, String>>) {
        writeLines(indexFile, entries.map { "${it.first}|${it.second}" })
    }

    private fun readLines(path: String): List<String> {
        val content =
            NSString.create(
                contentsOfFile = path,
                encoding = NSUTF8StringEncoding,
                error = null,
            ) ?: return emptyList()
        return content.toString().lines().filter { it.isNotBlank() }
    }

    private fun writeLines(
        path: String,
        lines: List<String>,
    ) {
        val content = lines.joinToString("\n")
        NSString.create(string = content).writeToFile(path, true, NSUTF8StringEncoding, null)
    }

    private fun detectImageExtension(data: ByteArray): String {
        if (data.size >= 4) {
            if (data[0] == 0x47.toByte() &&
                data[1] == 0x49.toByte() &&
                data[2] == 0x46.toByte() &&
                data[3] == 0x38.toByte()
            ) {
                return "gif"
            }
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
        }
        return "png"
    }
}
