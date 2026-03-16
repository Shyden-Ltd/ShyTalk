package com.shyden.shytalk.core.util

actual suspend fun compressImage(
    imageData: ByteArray,
    maxDimension: Int,
    quality: Int,
): ByteArray = imageData // No-op for JVM test target
