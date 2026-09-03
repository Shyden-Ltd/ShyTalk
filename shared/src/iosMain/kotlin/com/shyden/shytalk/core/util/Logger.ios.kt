package com.shyden.shytalk.core.util

import platform.Foundation.NSLog

/**
 * iOS logging goes through the unified log, not stdout.
 *
 * `println` is the process's stdout, which only a debugger or a
 * `devicectl --console` attach can see: a full device syslog captured across
 * a launch carried none of it (SHY-0500, 2026-09-04). NSLog lands in the
 * unified log, which `idevicesyslog` streams over USB with nothing attached —
 * the same route the app's Swift side already uses.
 *
 * NSLog takes a FORMAT, so a message is escaped before it is handed over:
 * "50% done" must print as written, not be read as a directive.
 */
private fun emit(line: String) {
    NSLog(line.replace("%", "%%"))
}

actual fun logD(
    tag: String,
    message: String,
) {
    emit("D/$tag: $message")
}

actual fun logI(
    tag: String,
    message: String,
) {
    emit("I/$tag: $message")
}

actual fun logW(
    tag: String,
    message: String,
    throwable: Throwable?,
) {
    emit("W/$tag: $message")
    throwable?.let { emit("W/$tag: ${it.stackTraceToString()}") }
}

actual fun logE(
    tag: String,
    message: String,
    throwable: Throwable?,
) {
    emit("E/$tag: $message")
    throwable?.let { emit("E/$tag: ${it.stackTraceToString()}") }
}

actual fun logF(
    tag: String,
    message: String,
    throwable: Throwable?,
) {
    emit("F/$tag: $message")
    throwable?.let { emit("F/$tag: ${it.stackTraceToString()}") }
}
