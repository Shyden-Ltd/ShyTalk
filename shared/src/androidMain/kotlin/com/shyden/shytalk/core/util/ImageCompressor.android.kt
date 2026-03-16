package com.shyden.shytalk.core.util

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import kotlinx.coroutines.Dispatchers
import kotlinx.coroutines.withContext
import java.io.ByteArrayOutputStream
import kotlin.math.max

actual suspend fun compressImage(
    imageData: ByteArray,
    maxDimension: Int,
    quality: Int,
): ByteArray =
    withContext(Dispatchers.Default) {
        val original =
            BitmapFactory.decodeByteArray(imageData, 0, imageData.size)
                ?: return@withContext imageData

        val width = original.width
        val height = original.height
        val maxSide = max(width, height)

        val scaled =
            if (maxSide > maxDimension) {
                val scale = maxDimension.toFloat() / maxSide
                val newWidth = (width * scale).toInt()
                val newHeight = (height * scale).toInt()
                Bitmap.createScaledBitmap(original, newWidth, newHeight, true).also {
                    if (it !== original) original.recycle()
                }
            } else {
                original
            }

        val output = ByteArrayOutputStream()
        scaled.compress(Bitmap.CompressFormat.JPEG, quality, output)
        scaled.recycle()
        output.toByteArray()
    }
