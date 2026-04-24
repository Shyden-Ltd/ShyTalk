package com.shyden.shytalk.core.platform

import androidx.compose.runtime.Composable
import com.shyden.shytalk.util.IosImagePicker

@Composable
actual fun PlatformImagePicker(
    onImageSelected: (ByteArray?) -> Unit,
    content: @Composable (launchPicker: () -> Unit) -> Unit,
) {
    content {
        IosImagePicker.pickSingleImage { bytes ->
            onImageSelected(bytes)
        }
    }
}

@Composable
actual fun PlatformProfilePhotoPicker(
    onImageSelected: (ByteArray?) -> Unit,
    content: @Composable (launchPicker: () -> Unit) -> Unit,
) {
    // iOS: PHPicker returns pre-compressed JPEG — no separate crop step needed
    // A future enhancement could add UIImagePickerController with allowsEditing for circle crop
    content {
        IosImagePicker.pickSingleImage { bytes ->
            onImageSelected(bytes)
        }
    }
}

@Composable
actual fun PlatformMultiImagePicker(
    maxCount: Int,
    onImagesSelected: (List<ByteArray>) -> Unit,
    content: @Composable (launchPicker: () -> Unit) -> Unit,
) {
    content {
        IosImagePicker.pickImages(maxCount = maxCount) { images ->
            onImagesSelected(images)
        }
    }
}
