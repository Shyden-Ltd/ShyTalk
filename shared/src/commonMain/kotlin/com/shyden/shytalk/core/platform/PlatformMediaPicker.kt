package com.shyden.shytalk.core.platform

import androidx.compose.runtime.Composable

/**
 * One file somebody chose, with the type the platform says it actually is.
 *
 * [contentType] is the load-bearing part and the reason this exists alongside
 * [PlatformMultiImagePicker]. That picker returns bytes only, so every caller
 * has to decide for itself what it just received — and the one that mattered,
 * report evidence, hardcoded `"image/jpeg"` for everything. The admin panel has
 * had a complete video path since it was written, and could never be shown one
 * ([[SHY-0400]]).
 *
 * Not a `data class`: it holds a [ByteArray], whose `equals` compares identity
 * rather than contents, so a generated `equals` would be quietly wrong.
 */
class PickedMedia(
    val bytes: ByteArray,
    val contentType: String,
    val displayName: String,
    /**
     * How long a video runs, or null for a still image AND for a video whose
     * duration could not be read — SHY-0387's corrected limits.
     *
     * The platform that produced the file reports this, because only it still
     * holds the source the duration can be read from. By the time the bytes
     * reach the ViewModel the container is all that is left, and parsing MP4
     * atoms by hand to recover a number the OS already knows would be absurd.
     *
     * Null for a video is NOT treated as "fine": the 30-second rule cannot be
     * honoured without it, so the ViewModel refuses and says so.
     */
    val durationMs: Long? = null,
)

/**
 * Pick images **and** videos — SHY-0387.
 *
 * The operator asked for "screenshots or videos" on the support page, and report
 * evidence needs the same thing ([[SHY-0400]]). Build it once here rather than
 * growing a second picker beside [PlatformMultiImagePicker].
 *
 * @param maxCount most the person may choose at once
 * @param onMediaSelected chosen files, in the order picked; empty if cancelled
 * @param content receives a function that opens the picker
 */
@Composable
expect fun PlatformMediaPicker(
    maxCount: Int,
    onMediaSelected: (List<PickedMedia>) -> Unit,
    content: @Composable (launchPicker: () -> Unit) -> Unit,
)
