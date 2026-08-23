package com.shyden.shytalk.core.ui

import androidx.compose.runtime.Composable
import androidx.compose.ui.Modifier

/**
 * Play a video that is already on this device — SHY-0433.
 *
 * Somebody attaching a clip to a support request has to be able to check WHICH
 * clip it is: two recordings made seconds apart are indistinguishable by
 * filename, and a video's usefulness depends entirely on it being the right one.
 *
 * @param localUri where the file is, in whatever form the platform's picker
 *   handed over — a content URI on Android, a temporary file path on iOS. This
 *   never touches the network: the bytes are already here, and re-fetching what
 *   somebody just picked would be absurd.
 *
 * **With sound.** A muted preview would leave somebody unable to tell whether
 * the audio is the part that matters, which for a harassment report it often
 * is. Both platform players below are built from framework classes — Android's
 * `VideoView`, iOS's `AVPlayerViewController` — so this costs no dependency.
 */
@Composable
expect fun PlatformVideoPlayer(
    localUri: String,
    modifier: Modifier = Modifier,
)
