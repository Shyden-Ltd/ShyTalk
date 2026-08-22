package com.shyden.shytalk.core.platform

import android.media.MediaMetadataRetriever
import android.net.Uri
import android.provider.OpenableColumns
import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

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
            PickedMedia(
                bytes = bytes,
                contentType = contentType,
                displayName = displayNameOf(uri),
                // Only asked for video. Running the retriever over a JPEG costs
                // a file open and returns nothing useful.
                durationMs = if (contentType.startsWith("video/")) videoDurationMs(uri) else null,
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
