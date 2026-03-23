package com.shyden.shytalk.core.crop

import android.app.Activity
import android.content.Intent
import android.graphics.Bitmap
import android.graphics.Color
import android.net.Uri
import android.os.Bundle
import androidx.activity.SystemBarStyle
import androidx.activity.enableEdgeToEdge
import androidx.appcompat.app.AppCompatActivity
import androidx.core.net.toUri
import androidx.core.view.ViewCompat
import androidx.core.view.WindowInsetsCompat
import com.canhub.cropper.CropImageView
import com.shyden.shytalk.R
import java.io.File

class CropActivity :
    AppCompatActivity(),
    CropImageView.OnCropImageCompleteListener {
    private lateinit var cropImageView: CropImageView
    private var quality: Int = 80

    override fun onCreate(savedInstanceState: Bundle?) {
        enableEdgeToEdge(
            statusBarStyle = SystemBarStyle.dark(Color.parseColor("#FF444444")),
        )
        super.onCreate(savedInstanceState)
        setContentView(R.layout.activity_crop)

        ViewCompat.setOnApplyWindowInsetsListener(findViewById(android.R.id.content)) { view, insets ->
            val bars = insets.getInsets(WindowInsetsCompat.Type.systemBars())
            view.setPadding(bars.left, bars.top, bars.right, bars.bottom)
            WindowInsetsCompat.CONSUMED
        }

        cropImageView = findViewById(R.id.cropImageView)

        val imageUri = intent.getStringExtra(EXTRA_IMAGE_URI)?.let { Uri.parse(it) }
        val aspectX = intent.getIntExtra(EXTRA_ASPECT_X, 1)
        val aspectY = intent.getIntExtra(EXTRA_ASPECT_Y, 1)
        val cropShape = intent.getStringExtra(EXTRA_CROP_SHAPE) ?: "rectangle"
        quality = intent.getIntExtra(EXTRA_QUALITY, 80)
        val title = intent.getStringExtra(EXTRA_TITLE) ?: "Crop"

        findViewById<android.widget.TextView>(R.id.tvTitle).text = title

        cropImageView.setAspectRatio(aspectX, aspectY)
        cropImageView.setFixedAspectRatio(true)
        cropImageView.guidelines = CropImageView.Guidelines.ON
        cropImageView.cropShape =
            if (cropShape == "oval") {
                CropImageView.CropShape.OVAL
            } else {
                CropImageView.CropShape.RECTANGLE
            }

        if (imageUri != null) {
            cropImageView.setImageUriAsync(imageUri)
        } else {
            setResult(Activity.RESULT_CANCELED)
            finish()
            return
        }

        findViewById<android.widget.ImageButton>(R.id.btnCancel).setOnClickListener {
            setResult(Activity.RESULT_CANCELED)
            finish()
        }

        findViewById<android.widget.ImageButton>(R.id.btnDone).setOnClickListener {
            cropImageView.croppedImageAsync()
        }
    }

    override fun onStart() {
        super.onStart()
        cropImageView.setOnCropImageCompleteListener(this)
    }

    override fun onStop() {
        super.onStop()
        cropImageView.setOnCropImageCompleteListener(null)
    }

    override fun onCropImageComplete(
        view: CropImageView,
        result: CropImageView.CropResult,
    ) {
        if (result.isSuccessful) {
            val bitmap = result.bitmap
            if (bitmap != null) {
                val outputFile = File(cacheDir, "cropped_${System.currentTimeMillis()}.jpg")
                outputFile.outputStream().use { out ->
                    bitmap.compress(Bitmap.CompressFormat.JPEG, quality, out)
                }
                bitmap.recycle()
                val data =
                    Intent().apply {
                        putExtra(EXTRA_RESULT_URI, outputFile.toUri().toString())
                    }
                setResult(Activity.RESULT_OK, data)
            } else {
                setResult(Activity.RESULT_CANCELED)
            }
        } else {
            setResult(Activity.RESULT_CANCELED)
        }
        finish()
    }

    companion object {
        const val EXTRA_IMAGE_URI = "imageUri"
        const val EXTRA_ASPECT_X = "aspectRatioX"
        const val EXTRA_ASPECT_Y = "aspectRatioY"
        const val EXTRA_CROP_SHAPE = "cropShape"
        const val EXTRA_QUALITY = "quality"
        const val EXTRA_TITLE = "title"
        const val EXTRA_RESULT_URI = "resultUri"
    }
}
