@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)

package com.shyden.shytalk.core.util

import kotlinx.cinterop.addressOf
import kotlinx.cinterop.usePinned
import platform.Foundation.NSData
import platform.posix.memcpy

/** Copies the bytes of this [NSData] into a Kotlin array. */
internal fun NSData.toByteArray(): ByteArray {
    val size = length.toInt()
    if (size == 0) return ByteArray(0)
    val bytes = ByteArray(size)
    bytes.usePinned { pinned -> memcpy(pinned.addressOf(0), this.bytes, length) }
    return bytes
}
