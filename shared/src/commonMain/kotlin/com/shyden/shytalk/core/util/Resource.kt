package com.shyden.shytalk.core.util

sealed class Resource<out T> {
    data class Success<T>(
        val data: T,
    ) : Resource<T>()

    data class Error(
        val message: String,
        val exception: Throwable? = null,
    ) : Resource<Nothing>()

    data object Loading : Resource<Nothing>()
}
