package com.shyden.shytalk.core.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.UIKitInteropInteractionMode
import androidx.compose.ui.viewinterop.UIKitInteropProperties
import androidx.compose.ui.viewinterop.UIKitView
import kotlinx.cinterop.ExperimentalForeignApi
import platform.AVFoundation.AVPlayer
import platform.AVFoundation.play
import platform.AVKit.AVPlayerViewController
import platform.Foundation.NSURL

/**
 * `AVPlayerViewController` from AVKit, which is part of the OS.
 *
 * Its own controls, so play, pause, scrubbing and the volume behave exactly as
 * they do in Photos. `NonCooperative` interaction is required: the player's
 * gestures — scrubbing especially — must reach UIKit rather than being read as
 * a scroll by the Compose layer above it, which is what happens by default.
 */
@OptIn(ExperimentalForeignApi::class)
@Composable
actual fun PlatformVideoPlayer(
    localUri: String,
    modifier: Modifier,
) {
    UIKitView(
        factory = {
            val controller = AVPlayerViewController()
            // A file path, not a web URL: the picker wrote this out locally.
            // `URLWithString` would return null for a bare path and the player
            // would show a black rectangle with no error.
            val url = NSURL.fileURLWithPath(localUri)
            controller.player = AVPlayer(uRL = url).also { it.play() }
            controller.view
        },
        modifier = modifier,
        properties =
            UIKitInteropProperties(
                interactionMode = UIKitInteropInteractionMode.NonCooperative,
                isNativeAccessibilityEnabled = true,
            ),
    )
}
