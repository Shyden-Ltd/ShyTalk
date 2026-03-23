package com.shyden.shytalk.core.crop

import android.app.Activity
import android.content.Context
import android.content.Intent
import android.net.Uri
import androidx.activity.result.contract.ActivityResultContract

data class CropInput(
    val uri: Uri,
    val aspectRatioX: Int,
    val aspectRatioY: Int,
    val cropShape: String = "rectangle",
    val quality: Int = 80,
    val title: String = "Crop",
)

class CropContract : ActivityResultContract<CropInput, Uri?>() {
    override fun createIntent(
        context: Context,
        input: CropInput,
    ): Intent =
        Intent(context, CropActivity::class.java).apply {
            putExtra(CropActivity.EXTRA_IMAGE_URI, input.uri.toString())
            putExtra(CropActivity.EXTRA_ASPECT_X, input.aspectRatioX)
            putExtra(CropActivity.EXTRA_ASPECT_Y, input.aspectRatioY)
            putExtra(CropActivity.EXTRA_CROP_SHAPE, input.cropShape)
            putExtra(CropActivity.EXTRA_QUALITY, input.quality)
            putExtra(CropActivity.EXTRA_TITLE, input.title)
            addFlags(Intent.FLAG_GRANT_READ_URI_PERMISSION)
        }

    override fun parseResult(
        resultCode: Int,
        intent: Intent?,
    ): Uri? {
        if (resultCode != Activity.RESULT_OK) return null
        val uriString = intent?.getStringExtra(CropActivity.EXTRA_RESULT_URI) ?: return null
        return Uri.parse(uriString)
    }
}
