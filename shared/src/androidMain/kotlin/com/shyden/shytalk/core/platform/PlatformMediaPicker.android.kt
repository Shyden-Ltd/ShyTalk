package com.shyden.shytalk.core.platform

import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext
import java.io.ByteArrayOutputStream

private const val TAG = "PlatformMediaPicker"

/** Fallback when the resolver cannot say — never guessed as an image. */
private const val UNKNOWN_TYPE = "application/octet-stream"

@Composable
actual fun PlatformMediaPicker(
    maxCount: Int,
    onMediaSelected: (List<PickedMedia>) -> Unit,
    content: @Composable (launchPicker: () -> Unit) -> Unit,
) {
    val context = LocalContext.current
    val launcher =
        rememberLauncherForActivityResult(
            ActivityResultContracts.PickMultipleVisualMedia(maxCount),
        ) { uris ->
            onMediaSelected(uris.mapNotNull { context.readPicked(it) })
        }

    // ImageAndVideo, not ImageOnly. The whole point of this picker.
    content {
        Log.i(TAG, "launching media picker")
        try {
            launcher.launch(
                PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageAndVideo),
            )
        } catch (e: Exception) {
            Log.e(TAG, "media picker failed to launch", e)
        }
    }
}

/**
 * Read one chosen file, asking the resolver what it IS rather than assuming.
 *
 * A file that cannot be read is dropped with a log rather than surfaced as an
 * empty attachment — an entry in the list for bytes nobody has is a ticket that
 * references nothing.
 */
private fun android.content.Context.readPicked(uri: Uri): PickedMedia? =
    try {
        val bytes = contentResolver.openInputStream(uri)?.use { it.readBytes() }
        if (bytes == null) {
            Log.w(TAG, "Could not open $uri")
            null
        } else {
            val contentType = contentResolver.getType(uri) ?: UNKNOWN_TYPE
            val isVideo = contentType.startsWith("video/")
            PickedMedia(
                bytes = bytes,
                contentType = contentType,
                displayName = displayNameOf(uri),
                // Only asked for video. Running the retriever over a JPEG costs
                // a file open and returns nothing useful.
                durationMs = if (isVideo) videoDurationMs(uri) else null,
                previewBytes = if (isVideo) videoPosterFrame(uri) else imageThumbnail(bytes),
                // A video is played from the file; an image is drawn from its
                // thumbnail, so it does not need one.
                localUri = if (isVideo) uri.toString() else null,
            )
        }
    } catch (e: Exception) {
        Log.w(TAG, "Could not read $uri", e)
        null
    }

/**
 * How long a video runs, in milliseconds, or null if it cannot be determined.
 *
 * Null is a real answer, not a failure to handle: the caller refuses a video it
 * cannot measure, because the 30-second rule cannot be honoured on a guess.
 * `MediaMetadataRetriever` must be released or it leaks a native handle per
 * pick, which on a ten-file selection is ten.
 */
private fun android.content.Context.videoDurationMs(uri: Uri): Long? {
    val retriever = MediaMetadataRetriever()
    return try {
        retriever.setDataSource(this, uri)
        retriever.extractMetadata(MediaMetadataRetriever.METADATA_KEY_DURATION)?.toLongOrNull()
    } catch (e: Exception) {
        Log.w(TAG, "Could not read duration of $uri", e)
        null
    } finally {
        try {
            retriever.release()
        } catch (e: Exception) {
            Log.w(TAG, "MediaMetadataRetriever would not release", e)
        }
    }
}

/** The name the person recognises, falling back to the last path segment. */
private fun android.content.Context.displayNameOf(uri: Uri): String =
    try {
        contentResolver.query(uri, arrayOf(OpenableColumns.DISPLAY_NAME), null, null, null)?.use {
            if (it.moveToFirst() && !it.isNull(0)) it.getString(0) else null
        } ?: uri.lastPathSegment.orEmpty()
    } catch (e: Exception) {
        Log.w(TAG, "Could not read a display name for $uri", e)
        uri.lastPathSegment.orEmpty()
    }

/**
 * The longest side a preview is allowed to be — SHY-0433.
 *
 * Big enough to fill a phone screen when tapped, small enough that ten of them
 * are a few megabytes rather than fifty. The point of the preview is to answer
 * "is this the right screenshot", and that does not need the original.
 */
private const val PREVIEW_MAX_EDGE = 1280

/** JPEG quality for previews. Visually indistinguishable at this size. */
private const val PREVIEW_QUALITY = 80

/**
 * A downscaled JPEG of an image, or null if it could not be decoded.
 *
 * Decoded through `inSampleSize`, which is the whole point: `decodeByteArray`
 * without it allocates the FULL bitmap first -- a 5 MB JPEG is roughly 50 MB of
 * ARGB_8888 -- and doing that ten times over is how a list of thumbnails
 * becomes an out-of-memory crash. The bounds pass reads only the header.
 */
private fun imageThumbnail(bytes: ByteArray): ByteArray? =
    try {
        val bounds = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, bounds)
        val longest = maxOf(bounds.outWidth, bounds.outHeight)
        val options =
            BitmapFactory.Options().apply {
                inSampleSize = sampleSizeFor(longest)
            }
        BitmapFactory.decodeByteArray(bytes, 0, bytes.size, options)?.let { bitmap ->
            try {
                bitmap.toJpeg()
            } finally {
                bitmap.recycle()
            }
        }
    } catch (e: Exception) {
        // Not fatal. A file we cannot thumbnail is still a file they attached.
        Log.w(TAG, "Could not make a thumbnail", e)
        null
    }

/**
 * The power of two that brings [longestEdge] under [PREVIEW_MAX_EDGE].
 *
 * `inSampleSize` only honours powers of two, so anything else is rounded down
 * by the decoder anyway.
 */
internal fun sampleSizeFor(longestEdge: Int): Int {
    var sample = 1
    while (longestEdge / sample > PREVIEW_MAX_EDGE) sample *= 2
    return sample
}

/** The first frame of a video, so it can be told from a still at a glance. */
private fun android.content.Context.videoPosterFrame(uri: Uri): ByteArray? {
    val retriever = MediaMetadataRetriever()
    return try {
        retriever.setDataSource(this, uri)
        // Time 0 rather than a "representative" frame: it is what the person
        // pressed record on, and `getFrameAtTime()` with no argument can return
        // a black frame from a fade-in.
        retriever.getFrameAtTime(0)?.let { frame ->
            try {
                frame.toJpeg()
            } finally {
                frame.recycle()
            }
        }
    } catch (e: Exception) {
        Log.w(TAG, "Could not read a poster frame from $uri", e)
        null
    } finally {
        try {
            retriever.release()
        } catch (e: Exception) {
            Log.w(TAG, "MediaMetadataRetriever would not release", e)
        }
    }
}

private fun Bitmap.toJpeg(): ByteArray =
    ByteArrayOutputStream().use { out ->
        compress(Bitmap.CompressFormat.JPEG, PREVIEW_QUALITY, out)
        out.toByteArray()
    }
