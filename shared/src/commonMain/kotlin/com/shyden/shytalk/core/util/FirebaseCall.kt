package com.shyden.shytalk.core.util

import kotlinx.coroutines.CancellationException

/**
 * Wraps a suspend block in a try-catch and returns [Resource.Success] or [Resource.Error].
 * Eliminates the repeated try-catch-Resource.Error boilerplate across repositories.
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
        Resource.Error(e.message ?: errorMessage, e)
    }
