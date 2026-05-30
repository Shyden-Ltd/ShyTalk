package com.shyden.shytalk.feature.auth

import androidx.compose.ui.Modifier

/**
 * iOS: no-op. The iOS UI driver uses XCTest's accessibility identifier
 * which Compose Multiplatform's testTag already feeds into via the
 * iOS-side accessibility tree; no extra semantics modifier is required.
 */
actual fun Modifier.exposeTestTagsToPlatformDumps(): Modifier = this
