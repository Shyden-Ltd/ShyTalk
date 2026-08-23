package com.shyden.shytalk.core.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

@Suppress("ktlint:standard:function-naming", "UNUSED_PARAMETER")
@Composable
actual fun PlatformVideoPlayer(
    localUri: String,
    modifier: Modifier,
) {
    // No-op for the JVM test target. The players that matter are Android's
    // VideoView and iOS's AVPlayerViewController, and neither is reachable
    // here; a desktop implementation would be a third thing to keep correct
    // for a target no person ever runs.
}
