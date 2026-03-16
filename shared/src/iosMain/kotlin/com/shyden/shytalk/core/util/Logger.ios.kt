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
    throwable?.let { println("W/$tag: ${it.stackTraceToString()}") }
}

actual fun logE(
    tag: String,
    message: String,
    throwable: Throwable?,
) {
    println("E/$tag: $message")
    throwable?.let { println("E/$tag: ${it.stackTraceToString()}") }
}

actual fun logF(
    tag: String,
    message: String,
    throwable: Throwable?,
) {
    println("F/$tag: $message")
    throwable?.let { println("F/$tag: ${it.stackTraceToString()}") }
}
