package com.shyden.shytalk.core.util

actual fun logD(
    tag: String,
    message: String,
) {
    println("D/$tag: $message")
}

actual fun logI(
    tag: String,
    message: String,
) {
    println("I/$tag: $message")
}

actual fun logW(
    tag: String,
    message: String,
    throwable: Throwable?,
) {
    println("W/$tag: $message")
}

actual fun logE(
    tag: String,
    message: String,
    throwable: Throwable?,
) {
    System.err.println("E/$tag: $message")
}

actual fun logF(
    tag: String,
    message: String,
    throwable: Throwable?,
) {
    System.err.println("F/$tag: $message")
}
