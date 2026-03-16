package com.shyden.shytalk.core.util

expect fun logD(
    tag: String,
    message: String,
)

expect fun logI(
    tag: String,
    message: String,
)

expect fun logW(
    tag: String,
    message: String,
    throwable: Throwable? = null,
)

expect fun logE(
    tag: String,
    message: String,
    throwable: Throwable? = null,
)

expect fun logF(
    tag: String,
    message: String,
    throwable: Throwable? = null,
)
