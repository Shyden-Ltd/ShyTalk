package com.shyden.shytalk.core.util

import kotlinx.coroutines.CancellationException

/**
 * Wraps a suspend block in a try-catch and returns [Resource.Success] or [Resource.Error].
 * Eliminates the repeated try-catch-Resource.Error boilerplate across repositories.
 *
 * Catches and logs at error level so Sentry / logcat see the failure even
 * when the calling repository decides to swallow the resulting [Resource.Error]
 * (e.g. for fire-and-forget retries). [CancellationException] is rethrown
 * unchanged to preserve structured concurrency.
 */
suspend inline fun <T> firebaseCall(
    errorMessage: String = "Operation failed",
    crossinline block: suspend () -> T,
): Resource<T> =
    try {
        Resource.Success(block())
    } catch (e: CancellationException) {
        throw e
    } catch (e: Exception) {
        logE("firebaseCall", errorMessage, e)
        // Fall back to `errorMessage` when the exception's own message is null OR
        // empty. A bare `?:` only catches null, but an empty-string message gives
        // the user no actionable information either — so empty must also fall back
        // to the call-site's descriptive errorMessage (e.g. "Failed to kick user").
        Resource.Error(e.message?.takeIf { it.isNotEmpty() } ?: errorMessage, e)
    }
