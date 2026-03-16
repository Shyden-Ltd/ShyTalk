package com.shyden.shytalk.data.local

import com.shyden.shytalk.feature.messaging.Sticker

actual class StickerStorage {
    actual fun getStickers(): List<Sticker> = emptyList()

    actual fun addSticker(
        id: String,
        imageData: ByteArray,
    ): Sticker = Sticker(id, "")

    actual fun removeSticker(id: String) {}

    actual fun moveSticker(
        id: String,
        toIndex: Int,
    ) {}

    actual fun updateStickerUrl(
        id: String,
        url: String,
    ) {}

    actual fun getRecentStickers(): List<Sticker> = emptyList()

    actual fun markAsRecent(id: String) {}

    actual fun readStickerBytes(id: String): ByteArray? = null
}
