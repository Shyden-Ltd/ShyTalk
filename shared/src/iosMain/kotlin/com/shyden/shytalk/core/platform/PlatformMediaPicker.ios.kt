package com.shyden.shytalk.core.platform

import androidx.compose.runtime.Composable
import com.shyden.shytalk.util.IosMediaPicker

@Composable
actual fun PlatformMediaPicker(
    maxCount: Int,
    onMediaSelected: (List<PickedMedia>) -> Unit,
    content: @Composable (launchPicker: () -> Unit) -> Unit,
) {
    content {
        IosMediaPicker.pickMedia(maxCount = maxCount) { media ->
            onMediaSelected(media)
        }
    }
}
