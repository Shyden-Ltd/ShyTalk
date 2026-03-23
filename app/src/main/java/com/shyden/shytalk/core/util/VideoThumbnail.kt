package com.shyden.shytalk.core.util

import android.content.Context
import android.graphics.Bitmap
import android.media.MediaMetadataRetriever
import android.net.Uri
import java.io.ByteArrayOutputStream

object VideoThumbnail {
    fun extractVideoThumbnail(
        context: Context,
        uri: Uri,
    ): ByteArray? {
        val retriever = MediaMetadataRetriever()
        return try {
            context.contentResolver.openFileDescriptor(uri, "r")?.use { pfd ->
                retriever.setDataSource(pfd.fileDescriptor)
            }
            val bitmap =
                retriever.getFrameAtTime(0, MediaMetadataRetriever.OPTION_CLOSEST_SYNC)
                    ?: return null
            val stream = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.JPEG, 75, stream)
            bitmap.recycle()
            stream.toByteArray()
        } catch (e: Exception) {
            null
        } finally {
            retriever.release()
        }
    }
}
