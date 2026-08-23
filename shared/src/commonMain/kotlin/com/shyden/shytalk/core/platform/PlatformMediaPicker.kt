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
    /**
     * A downscaled copy for showing this file on screen — SHY-0433.
     *
     * Made by the platform, because only it still holds the original in a form
     * it can decode cheaply. A thumbnail for an image, a poster frame for a
     * video. Null when one could not be produced, which is not fatal: the file
     * is still attached, still named, and still removable.
     *
     * Never the original bytes. Ten 5 MB images kept for a row 80 pixels tall
     * is 50 MB held for nothing, and the performance clause of SHY-0433 says
     * the decode must not happen at full size in the first place.
     */
    val previewBytes: ByteArray? = null,
    /**
     * Where the file still is on the device, for playing a video full screen.
     *
     * A video cannot be played from a poster frame, and re-downloading what the
     * person has locally would be absurd. Null for an image.
     */
    val localUri: String? = null,
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
