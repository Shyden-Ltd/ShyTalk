package com.shyden.shytalk.core.ui

import android.net.Uri
import android.widget.MediaController
import android.widget.VideoView
import androidx.compose.runtime.Composable
import androidx.compose.runtime.DisposableEffect
import androidx.compose.ui.Modifier
import androidx.compose.ui.viewinterop.AndroidView

/**
 * `VideoView` from the framework, not a media library.
 *
 * ExoPlayer would be the reach for a streaming product; this plays a local file
 * the person picked seconds ago, once, to confirm it is the right one. A new
 * dependency for that would be paid for in every build and every APK.
 */
@Composable
actual fun PlatformVideoPlayer(
    localUri: String,
    modifier: Modifier,
) {
    AndroidView(
        factory = { context ->
            VideoView(context).apply {
                setVideoURI(Uri.parse(localUri))
                // The controls come from the framework too, so play, pause and
                // the scrub bar behave the way they do everywhere else on the
                // device rather than the way we happened to build them.
                setMediaController(MediaController(context).also { it.setAnchorView(this) })
                setOnPreparedListener { start() }
            }
        },
        // Released when the preview closes. A VideoView left holding a decoder
        // keeps the file open and, on some devices, the only hardware decoder.
        onRelease = { it.stopPlayback() },
        modifier = modifier,
    )
    DisposableEffect(localUri) { onDispose {} }
}
