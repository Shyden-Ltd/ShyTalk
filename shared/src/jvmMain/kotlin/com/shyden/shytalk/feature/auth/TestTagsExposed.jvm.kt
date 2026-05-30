package com.shyden.shytalk.feature.auth

import androidx.compose.ui.Modifier

/**
 * JVM (desktop / unit-test environment): no-op.
 *
 * The semantics modifier exists only to feed Android's uiautomator
 * dump — JVM Compose tests use the in-process [SemanticsNodeInteraction]
 * API which reads `testTag` directly.
 */
actual fun Modifier.exposeTestTagsToPlatformDumps(): Modifier = this
