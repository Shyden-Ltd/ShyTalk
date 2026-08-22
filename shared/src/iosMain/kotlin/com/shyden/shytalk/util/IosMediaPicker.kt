@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package com.shyden.shytalk.util

import com.shyden.shytalk.core.platform.PickedMedia
import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logW
import platform.AVFoundation.AVURLAsset
import platform.AVFoundation.duration
import platform.CoreMedia.CMTimeGetSeconds
import platform.Foundation.NSFileManager
import platform.Foundation.NSTemporaryDirectory
import platform.Foundation.NSURL
import platform.Foundation.NSUUID
import platform.Foundation.writeToFile
import platform.PhotosUI.PHPickerConfiguration
import platform.PhotosUI.PHPickerFilter
import platform.PhotosUI.PHPickerResult
import platform.PhotosUI.PHPickerViewController
import platform.PhotosUI.PHPickerViewControllerDelegateProtocol
import platform.UIKit.UIImage
import platform.UIKit.UIImageJPEGRepresentation
import platform.UniformTypeIdentifiers.UTTypeImage
import platform.UniformTypeIdentifiers.UTTypeMovie
import platform.UniformTypeIdentifiers.UTTypeQuickTimeMovie
import platform.darwin.NSObject

private const val TAG = "IosMediaPicker"
private const val JPEG_QUALITY = 0.8

/**
 * Pick images **and** videos — the iOS half of `PlatformMediaPicker` (SHY-0387).
 *
 * Separate from [IosImagePicker] rather than folded into it, because a video is
 * not an image with a different extension: its item provider hands back a movie
 * type identifier and raw data, and there is no `UIImage` to re-encode. Trying
 * to serve both from one delegate is how the images-only assumption got baked in
 * the first place.
 */
object IosMediaPicker {
    /**
     * The delegate, held where the GC can actually SEE it.
     *
     * `PHPickerViewController.delegate` is a WEAK property, so the picker does
     * not keep its delegate alive. The delegate used to try to solve that by
     * holding an instance property pointing at its own object. That is a
     * self-referential CYCLE with no external root, and Kotlin/Native's GC is a
     * tracing collector: an unreachable cycle is exactly what it reclaims.
     *
     * So the delegate could be collected between presenting the picker and the
     * person choosing a file. `delegate` then read nil and
     * `picker(_:didFinishPicking:)` never fired: the sheet stayed open, nothing
     * was added, and every further attempt stacked another picker until the app
     * had to be force-quit. It depended on GC timing, which is why it presented
     * as flakiness rather than as a feature that does not work at all.
     *
     * A Kotlin `object` IS a GC root, so a property on it genuinely holds the
     * delegate. One at a time is correct — only one picker can be on screen.
     */
    private var activeDelegate: MediaDelegate? = null

    fun pickMedia(
        maxCount: Int,
        onResult: (List<PickedMedia>) -> Unit,
    ) {
        val config = PHPickerConfiguration()
        config.selectionLimit = maxCount.toLong()
        // Images AND videos. The single line SHY-0400 turned on.
        config.filter =
            PHPickerFilter.anyFilterMatchingSubfilters(
                listOf(PHPickerFilter.imagesFilter, PHPickerFilter.videosFilter),
            )

        val picker = PHPickerViewController(configuration = config)
        val delegate = MediaDelegate(maxCount, onResult)
        activeDelegate = delegate
        picker.delegate = delegate
        IosImagePicker.presentPicker(picker)
    }

    @Suppress("PARAMETER_NAME_CHANGED_ON_OVERRIDE")
    private class MediaDelegate(
        private val maxCount: Int,
        private val onResult: (List<PickedMedia>) -> Unit,
    ) : NSObject(),
        PHPickerViewControllerDelegateProtocol {
        override fun picker(
            picker: PHPickerViewController,
            didFinishPicking: List<*>,
        ) {
            picker.dismissViewControllerAnimated(true, completion = null)

            val results = didFinishPicking.filterIsInstance<PHPickerResult>()
            if (results.isEmpty()) {
                onResult(emptyList())
                activeDelegate = null
                return
            }

            val picked = mutableListOf<PickedMedia>()
            var remaining = results.size

            fun finishOne() {
                remaining--
                if (remaining == 0) {
                    onResult(picked.take(maxCount))
                    activeDelegate = null
                }
            }

            for (result in results) {
                val name = result.itemProvider.suggestedName ?: "attachment"
                val isMovie = result.itemProvider.hasItemConformingToTypeIdentifier(UTTypeMovie.identifier)

                if (isMovie) {
                    result.itemProvider.loadDataRepresentationForTypeIdentifier(
                        UTTypeMovie.identifier,
                    ) { data, error ->
                        platform.darwin.dispatch_async(platform.darwin.dispatch_get_main_queue()) {
                            when {
                                error != null ->
                                    logE(TAG, "Could not load video: ${error.localizedDescription}")

                                data != null ->
                                    picked.add(
                                        PickedMedia(
                                            durationMs = videoDurationMs(data),
                                            bytes = nsDataToByteArray(data),
                                            // QuickTime is what the camera roll usually holds;
                                            // both are in the server's allowlist.
                                            contentType =
                                                if (result.itemProvider.hasItemConformingToTypeIdentifier(
                                                        UTTypeQuickTimeMovie.identifier,
                                                    )
                                                ) {
                                                    "video/quicktime"
                                                } else {
                                                    "video/mp4"
                                                },
                                            displayName = name,
                                        ),
                                    )

                                else -> logW(TAG, "Video load returned neither data nor error")
                            }
                            finishOne()
                        }
                    }
                } else {
                    result.itemProvider.loadDataRepresentationForTypeIdentifier(
                        UTTypeImage.identifier,
                    ) { data, error ->
                        platform.darwin.dispatch_async(platform.darwin.dispatch_get_main_queue()) {
                            when {
                                error != null ->
                                    logE(TAG, "Could not load image: ${error.localizedDescription}")

                                data != null -> {
                                    // Re-encoded to JPEG so the declared type and the
                                    // bytes agree — R2 signs the URL for one type.
                                    val jpeg = UIImageJPEGRepresentation(UIImage(data = data), JPEG_QUALITY)
                                    if (jpeg != null) {
                                        picked.add(
                                            PickedMedia(
                                                bytes = nsDataToByteArray(jpeg),
                                                contentType = "image/jpeg",
                                                displayName = name,
                                            ),
                                        )
                                    } else {
                                        logW(TAG, "JPEG compression returned null")
                                    }
                                }

                                else -> logW(TAG, "Image load returned neither data nor error")
                            }
                            finishOne()
                        }
                    }
                }
            }
        }
    }
}

/**
 * How long a video runs, in milliseconds, or null if it cannot be measured.
 *
 * `PHPickerResult` hands back DATA, not a file, and `AVURLAsset` needs a URL —
 * so the bytes are written to a temporary file just long enough to be measured,
 * then removed. Reading the container by hand to recover a number AVFoundation
 * already knows would be absurd, and getting it wrong would let an over-long
 * video through.
 *
 * Null is a real answer the caller acts on, not a failure swallowed: the
 * 30-second rule cannot be honoured on a guess, so an unmeasurable video is
 * refused and the person is told why.
 */
private fun videoDurationMs(data: platform.Foundation.NSData): Long? {
    val path = NSTemporaryDirectory() + "shytalk-duration-" + NSUUID().UUIDString + ".mov"
    return try {
        if (!data.writeToFile(path, true)) {
            logW(TAG, "Could not write the video out to measure it")
            return null
        }
        val seconds = CMTimeGetSeconds(AVURLAsset(NSURL.fileURLWithPath(path), null).duration)
        // NaN is what AVFoundation answers for a file it could not parse, and
        // zero for one with no track worth playing. Neither is a duration.
        if (seconds.isNaN() || seconds <= 0.0) {
            logW(TAG, "AVFoundation gave no usable duration")
            null
        } else {
            (seconds * 1000.0).toLong()
        }
    } catch (e: Exception) {
        logW(TAG, "Could not measure the video: ${e.message}")
        null
    } finally {
        // The temp file outlives the measurement otherwise, and a ten-video
        // pick would leave ten copies in the container.
        NSFileManager.defaultManager.removeItemAtPath(path, null)
    }
}
