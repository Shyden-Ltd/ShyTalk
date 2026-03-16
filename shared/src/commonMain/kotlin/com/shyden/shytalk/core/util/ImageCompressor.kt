package com.shyden.shytalk.core.util

/**
 * Compresses an image to a maximum dimension and JPEG quality.
 * Returns the compressed image as a ByteArray.
 */
expect suspend fun compressImage(
    imageData: ByteArray,
    maxDimension: Int = 1920,
    quality: Int = 80,
): ByteArray
