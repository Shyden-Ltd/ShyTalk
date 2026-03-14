package com.shyden.shytalk.core.util

actual fun getClipboardText(): String? {
    // Clipboard access on Android requires a Context.
    // The composable layer will use LocalClipboardManager instead.
    // This stub exists to satisfy the expect/actual contract.
    return null
}
