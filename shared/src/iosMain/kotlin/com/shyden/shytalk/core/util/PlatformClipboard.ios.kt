package com.shyden.shytalk.core.util

actual fun getClipboardText(): String? {
    // Clipboard access deferred until iOS UI layer is implemented
    return null
}
