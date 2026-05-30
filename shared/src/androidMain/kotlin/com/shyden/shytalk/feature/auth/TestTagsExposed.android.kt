package com.shyden.shytalk.feature.auth

import androidx.compose.ui.Modifier
import androidx.compose.ui.semantics.semantics
import androidx.compose.ui.semantics.testTagsAsResourceId

/**
 * Android: apply `Modifier.semantics { testTagsAsResourceId = true }`
 * so testTags propagate into the uiautomator dump's `resource-id`
 * attribute. See the commonMain docstring for the rationale.
 */
@OptIn(androidx.compose.ui.ExperimentalComposeUiApi::class)
actual fun Modifier.exposeTestTagsToPlatformDumps(): Modifier = this.semantics { testTagsAsResourceId = true }
