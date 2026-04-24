package com.shyden.shytalk.core.platform

import androidx.compose.runtime.Composable

/**
 * Cross-platform image picker that returns selected image bytes.
 *
 * On Android: uses ActivityResultContracts.PickVisualMedia + CropContract.
 * On iOS: uses PHPickerViewController with JPEG compression.
 *
 * @param onImageSelected called with the image bytes (JPEG) when a photo is picked, or null if cancelled
 * @param content composable content that receives a launch function to trigger the picker
 */
@Composable
expect fun PlatformImagePicker(
    onImageSelected: (ByteArray?) -> Unit,
    content: @Composable (launchPicker: () -> Unit) -> Unit,
)

/**
 * Simpler version: picks an image and crops it to a circle (for profile photos).
 */
@Composable
expect fun PlatformProfilePhotoPicker(
    onImageSelected: (ByteArray?) -> Unit,
    content: @Composable (launchPicker: () -> Unit) -> Unit,
)

/**
 * Multi-image picker for evidence/attachments.
 */
@Composable
expect fun PlatformMultiImagePicker(
    maxCount: Int,
    onImagesSelected: (List<ByteArray>) -> Unit,
    content: @Composable (launchPicker: () -> Unit) -> Unit,
)
