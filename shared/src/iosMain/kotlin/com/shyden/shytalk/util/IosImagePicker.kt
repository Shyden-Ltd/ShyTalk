@file:OptIn(kotlinx.cinterop.ExperimentalForeignApi::class, kotlinx.cinterop.BetaInteropApi::class)

package com.shyden.shytalk.util

import com.shyden.shytalk.core.util.logE
import com.shyden.shytalk.core.util.logW
import kotlinx.cinterop.refTo
import platform.Foundation.NSData
import platform.PhotosUI.PHPickerConfiguration
import platform.PhotosUI.PHPickerFilter
import platform.PhotosUI.PHPickerResult
import platform.PhotosUI.PHPickerViewController
import platform.PhotosUI.PHPickerViewControllerDelegateProtocol
import platform.UIKit.UIApplication
import platform.UIKit.UIImage
import platform.UIKit.UIImageJPEGRepresentation
import platform.UniformTypeIdentifiers.UTTypeImage
import platform.darwin.NSObject
import platform.posix.memcpy

/**
 * iOS image picker using PHPickerViewController.
 *
 * Presents the system photo picker and delivers selected images as ByteArray.
 * Automatically compresses images to JPEG at 0.8 quality.
 */
object IosImagePicker {
    private const val JPEG_QUALITY = 0.8

    fun pickImages(
        maxCount: Int,
        onResult: (List<ByteArray>) -> Unit,
    ) {
        val config = PHPickerConfiguration()
        config.selectionLimit = maxCount.toLong()
        config.filter = PHPickerFilter.imagesFilter

        val picker = PHPickerViewController(configuration = config)
        val delegate = PickerDelegate(maxCount, onResult)
        picker.delegate = delegate

        presentPicker(picker)
    }

    fun pickSingleImage(onResult: (ByteArray?) -> Unit) {
        pickImages(maxCount = 1) { results ->
            onResult(results.firstOrNull())
        }
    }

    private fun presentPicker(picker: PHPickerViewController) {
        val rootVc = getRootViewController()
        if (rootVc == null) {
            logW("IosImagePicker", "No root view controller available to present picker")
            return
        }
        rootVc.presentViewController(picker, animated = true, completion = null)
    }

    private fun getRootViewController(): platform.UIKit.UIViewController? {
        val scenes = UIApplication.sharedApplication.connectedScenes
        for (scene in scenes) {
            val windowScene = scene as? platform.UIKit.UIWindowScene ?: continue
            val window = windowScene.keyWindow ?: continue
            return window.rootViewController
        }
        return null
    }

    @Suppress("PARAMETER_NAME_CHANGED_ON_OVERRIDE")
    private class PickerDelegate(
        private val maxCount: Int,
        private val onResult: (List<ByteArray>) -> Unit,
    ) : NSObject(),
        PHPickerViewControllerDelegateProtocol {
        // Strong reference to self to prevent GC before callback
        private var selfRef: PickerDelegate? = this

        override fun picker(
            picker: PHPickerViewController,
            didFinishPicking: List<*>,
        ) {
            picker.dismissViewControllerAnimated(true, completion = null)

            val results = didFinishPicking.filterIsInstance<PHPickerResult>()
            if (results.isEmpty()) {
                onResult(emptyList())
                selfRef = null
                return
            }

            val images = mutableListOf<ByteArray>()
            var remaining = results.size

            for (result in results) {
                result.itemProvider.loadDataRepresentationForTypeIdentifier(
                    UTTypeImage.identifier,
                ) { data, error ->
                    // Dispatch to main thread to avoid race conditions on shared state
                    platform.darwin.dispatch_async(platform.darwin.dispatch_get_main_queue()) {
                        if (error != null) {
                            logE("IosImagePicker", "Failed to load image: ${error.localizedDescription}")
                        } else if (data != null) {
                            val image = UIImage(data = data)
                            val jpegData = UIImageJPEGRepresentation(image, JPEG_QUALITY)
                            if (jpegData != null) {
                                val bytes = nsDataToByteArray(jpegData)
                                images.add(bytes)
                            } else {
                                logW("IosImagePicker", "JPEG compression returned null for image")
                            }
                        } else {
                            logW("IosImagePicker", "Image load returned neither data nor error")
                        }

                        remaining--
                        if (remaining == 0) {
                            onResult(images.take(maxCount))
                            selfRef = null
                        }
                    }
                }
            }
        }
    }
}

@OptIn(kotlinx.cinterop.ExperimentalForeignApi::class)
internal fun nsDataToByteArray(data: NSData): ByteArray {
    val length = data.length.toInt()
    if (length == 0) return ByteArray(0)
    val bytes = ByteArray(length)
    memcpy(bytes.refTo(0), data.bytes, data.length)
    return bytes
}
