package com.shyden.shytalk.feature.auth

import androidx.compose.ui.Modifier

/**
 * Exposes Compose [Modifier.testTag] values to platform UI dumps so the
 * /manual-qa runner's driver (uiautomator on Android, WebDriverAgent on
 * iOS) can locate elements by their testTag-as-resource-id.
 *
 * Without this on the AlertDialog content blocks, testTags set via
 * `Modifier.testTag("foo")` are visible to Compose Test but NOT to the
 * platform's accessibility tree — uiautomator's `resource-id` attribute
 * stays empty, breaking driver-side element lookup. The picker dialog's
 * persona rows hit this exact issue (j09 re-dispatch 2026-05-30):
 * uiautomator dump showed all rows with `resource-id=""` despite the
 * Compose source setting `.testTag("persona_row_<id>")`.
 *
 * Root cause: Material3 `AlertDialog` renders inside a separate
 * Popup/Dialog window, which has its OWN Compose subtree. The
 * `Modifier.semantics { testTagsAsResourceId = true }` set on
 * MainActivity's root composable doesn't propagate into the dialog's
 * subtree, so the testTags stay internal.
 *
 * **Android**: `Modifier.semantics { testTagsAsResourceId = true }`.
 * Apply once per Compose window (every Popup / Dialog / BottomSheet).
 *
 * **iOS**: no-op. The iOS UI driver uses a different lookup mechanism
 * (XCTest's accessibility identifier), and the `testTagsAsResourceId`
 * property is Android-specific.
 */
expect fun Modifier.exposeTestTagsToPlatformDumps(): Modifier
