package com.shyden.shytalk.core.platform

import androidx.compose.runtime.Composable

@Composable
actual fun PlatformImagePicker(
    onImageSelected: (ByteArray?) -> Unit,
    content: @Composable (launchPicker: () -> Unit) -> Unit,
) {
    content { /* No-op on JVM */ }
}

@Composable
actual fun PlatformProfilePhotoPicker(
    onImageSelected: (ByteArray?) -> Unit,
    content: @Composable (launchPicker: () -> Unit) -> Unit,
) {
    content { /* No-op on JVM */ }
}

@Composable
actual fun PlatformMultiImagePicker(
    maxCount: Int,
    onImagesSelected: (List<ByteArray>) -> Unit,
    content: @Composable (launchPicker: () -> Unit) -> Unit,
) {
    content { /* No-op on JVM */ }
}
