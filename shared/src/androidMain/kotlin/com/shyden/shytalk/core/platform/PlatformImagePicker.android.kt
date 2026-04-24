package com.shyden.shytalk.core.platform

import android.util.Log
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.result.PickVisualMediaRequest
import androidx.activity.result.contract.ActivityResultContracts
import androidx.compose.runtime.Composable
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.remember
import androidx.compose.runtime.setValue
import androidx.compose.ui.platform.LocalContext
import com.shyden.shytalk.core.crop.CropContract
import com.shyden.shytalk.core.crop.CropInput

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
    val context = LocalContext.current
    var pendingUri by remember { mutableStateOf<android.net.Uri?>(null) }

    val cropLauncher =
        rememberLauncherForActivityResult(CropContract()) { uri ->
            if (uri == null) {
                onImageSelected(null)
                return@rememberLauncherForActivityResult
            }
            val bytes =
                try {
                    context.contentResolver.openInputStream(uri)?.use { it.readBytes() }
                } catch (e: Exception) {
                    Log.w("PlatformImagePicker", "Failed to read cropped image", e)
                    null
                }
            onImageSelected(bytes)
        }

    val pickLauncher =
        rememberLauncherForActivityResult(ActivityResultContracts.PickVisualMedia()) { uri ->
            if (uri != null) {
                pendingUri = uri
                cropLauncher.launch(
                    CropInput(
                        uri = uri,
                        aspectRatioX = 1,
                        aspectRatioY = 1,
                        cropShape = "circle",
                        quality = 80,
                        title = "Crop Profile Photo",
                    ),
                )
            }
        }

    content { pickLauncher.launch(PickVisualMediaRequest(ActivityResultContracts.PickVisualMedia.ImageOnly)) }
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
