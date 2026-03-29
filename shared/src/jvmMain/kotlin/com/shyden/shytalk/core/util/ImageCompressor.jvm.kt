package com.shyden.shytalk.core.util

@Suppress("UNUSED_PARAMETER")
actual suspend fun compressImage(
    imageData: ByteArray,
    maxDimension: Int,
    quality: Int,
): ByteArray = imageData // No-op for JVM test target
