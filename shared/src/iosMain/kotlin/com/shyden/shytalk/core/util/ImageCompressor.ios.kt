package com.shyden.shytalk.core.util

import kotlinx.cinterop.ExperimentalForeignApi
import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import platform.CoreGraphics.CGBitmapContextCreate
import platform.CoreGraphics.CGBitmapContextCreateImage
import platform.CoreGraphics.CGColorSpaceCreateDeviceRGB
import platform.CoreGraphics.CGContextDrawImage
import platform.CoreGraphics.CGImageGetHeight
import platform.CoreGraphics.CGImageGetWidth
import platform.CoreGraphics.CGRectMake
import platform.Foundation.NSData
import platform.Foundation.create
import platform.UIKit.UIImage
import platform.UIKit.UIImageJPEGRepresentation
import platform.posix.memcpy

@OptIn(ExperimentalForeignApi::class)
actual suspend fun compressImage(
    imageData: ByteArray,
    maxDimension: Int,
    quality: Int
): ByteArray {
    val nsData = imageData.usePinned { pinned ->
        NSData.create(bytes = pinned.addressOf(0), length = imageData.size.toULong())
    }
    val image = UIImage.imageWithData(nsData) ?: return imageData

    // Scale down if needed
    val cgImage = image.CGImage ?: return imageData
    val origW = CGImageGetWidth(cgImage).toInt()
    val origH = CGImageGetHeight(cgImage).toInt()
    val maxSide = maxOf(origW, origH)

    val finalImage = if (maxSide > maxDimension) {
        val scale = maxDimension.toDouble() / maxSide
        val newW = (origW * scale).toInt()
        val newH = (origH * scale).toInt()
        val colorSpace = CGColorSpaceCreateDeviceRGB()
        // CGImageAlphaInfo.premultipliedLast = 1u
        val context = CGBitmapContextCreate(
            data = null,
            width = newW.toULong(),
            height = newH.toULong(),
            bitsPerComponent = 8u,
            bytesPerRow = (newW * 4).toULong(),
            space = colorSpace,
            bitmapInfo = 1u
        )
        if (context != null) {
            CGContextDrawImage(
                context,
                CGRectMake(0.0, 0.0, newW.toDouble(), newH.toDouble()),
                cgImage
            )
            val scaledCgImage = CGBitmapContextCreateImage(context)
            if (scaledCgImage != null) UIImage.imageWithCGImage(scaledCgImage) else image
        } else image
    } else image

    val compressionQuality = (quality.coerceIn(1, 100) / 100.0)
    val compressed = UIImageJPEGRepresentation(finalImage, compressionQuality) ?: return imageData

    val length = compressed.length.toInt()
    val result = ByteArray(length)
    result.usePinned { pinned ->
        memcpy(pinned.addressOf(0), compressed.bytes, compressed.length)
    }
    return result
}
