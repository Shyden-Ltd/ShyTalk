package com.shyden.shytalk.core.platform

import androidx.compose.runtime.Composable

/**
 * JVM has no photo library. The launcher is a no-op so `jvmTest` can compile the
 * screens that use it — the same shape the other pickers already take here.
 *
 * Nothing asserts picker BEHAVIOUR against this: that is what the device
 * journeys are for (j25). A test that passed against this no-op would be
 * testing nothing at all.
 */
@Composable
actual fun PlatformMediaPicker(
    maxCount: Int,
    onMediaSelected: (List<PickedMedia>) -> Unit,
    content: @Composable (launchPicker: () -> Unit) -> Unit,
) {
    content { /* No photo library on JVM */ }
}
