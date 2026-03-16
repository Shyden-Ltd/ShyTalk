package com.shyden.shytalk.core.util

import androidx.compose.runtime.Composable
import org.jetbrains.compose.resources.StringResource
import org.jetbrains.compose.resources.getString
import org.jetbrains.compose.resources.stringResource

/**
 * Wrapper that lets ViewModels reference localized strings without resolving them.
 * Resolution happens in the UI layer via [resolve] (Composable) or [resolveAsync] (suspend).
 */
sealed class UiText {
    data class Res(
        val resource: StringResource,
        val args: List<Any> = emptyList(),
    ) : UiText()

    data class Plain(
        val text: String,
    ) : UiText()

    /** Resolve inside a @Composable scope. */
    @Composable
    fun resolve(): String =
        when (this) {
            is Res ->
                if (args.isEmpty()) {
                    stringResource(resource)
                } else {
                    stringResource(resource, *args.toTypedArray())
                }
            is Plain -> text
        }

    /** Resolve inside a suspend scope (e.g. LaunchedEffect). */
    suspend fun resolveAsync(): String =
        when (this) {
            is Res ->
                if (args.isEmpty()) {
                    getString(resource)
                } else {
                    getString(resource, *args.toTypedArray())
                }
            is Plain -> text
        }

    companion object {
        fun res(
            resource: StringResource,
            vararg args: Any,
        ): UiText = Res(resource, args.toList())

        fun plain(text: String): UiText = Plain(text)
    }
}
