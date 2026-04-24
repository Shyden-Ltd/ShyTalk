package com.shyden.shytalk.core.platform

import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.ui.platform.LocalContext

@Composable
actual fun PlatformImagePicker(
    onImageSelected: (ByteArray?) -> Unit,
    content: @Composable (launchPicker: () -> Unit) -> Unit,
) {
    val context = LocalContext.current
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri == null) {
                onImageSelected(null)
                return@rememberLauncherForActivityResult
            }
            val bytes =
                try {
                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                } catch (e: Exception) {
                    Log.w("PlatformImagePicker", "Failed to read image", e)
                    null
                }
            onImageSelected(bytes)
        }
    content { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
}

@Composable
actual fun PlatformProfilePhotoPicker(
    onImageSelected: (ByteArray?) -> Unit,
    content: @Composable (launchPicker: () -> Unit) -> Unit,
) {
    // Pick image without crop — the server handles resizing.
    // Android-specific crop (CropActivity) remains available in app/ module
    // for screens that still use the Android-only NavGraph.
    val context = LocalContext.current
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri == null) {
                onImageSelected(null)
                return@rememberLauncherForActivityResult
            }
            val bytes =
                try {
                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                } catch (e: Exception) {
                    Log.w("PlatformImagePicker", "Failed to read image", e)
                    null
                }
            onImageSelected(bytes)
        }
    content { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
}

@Composable
actual fun PlatformMultiImagePicker(
    maxCount: Int,
    onImagesSelected: (List<ByteArray>) -> Unit,
    content: @Composable (launchPicker: () -> Unit) -> Unit,
) {
    val context = LocalContext.current
    val launcher =
        rememberLauncherForActivityResult(ActivityResultContracts.PickMultipleVisualMedia(maxCount)) { uris ->
            val images =
                uris.mapNotNull { uri ->
                    try {
                        context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                    } catch (e: Exception) {
                        Log.w("PlatformImagePicker", "Failed to read image", e)
                        null
                    }
                }
            onImagesSelected(images)
        }
    content { launcher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
}
