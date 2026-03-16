package com.shyden.shytalk.core.util

import android.util.Log

actual fun logD(
    tag: String,
    message: String,
) {
    Log.d(tag, message)
}

actual fun logI(
    tag: String,
    message: String,
) {
    Log.i(tag, message)
}

actual fun logW(
    tag: String,
    message: String,
    throwable: Throwable?,
) {
    Log.w(tag, message, throwable)
}

actual fun logE(
    tag: String,
    message: String,
    throwable: Throwable?,
) {
    Log.e(tag, message, throwable)
}

actual fun logF(
    tag: String,
    message: String,
    throwable: Throwable?,
) {
    Log.wtf(tag, message, throwable)
}
