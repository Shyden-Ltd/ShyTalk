package com.shyden.shytalk.data.local

import com.shyden.shytalk.feature.messaging.Sticker

expect class StickerStorage {
    fun getStickers(): List<Sticker>

    fun addSticker(
        id: String,
        imageData: ByteArray,
    ): Sticker

    fun removeSticker(id: String)

    fun moveSticker(
        id: String,
        toIndex: Int,
    )

    fun updateStickerUrl(
        id: String,
        url: String,
    )

    fun getRecentStickers(): List<Sticker>

    fun markAsRecent(id: String)

    fun readStickerBytes(id: String): ByteArray?
}
