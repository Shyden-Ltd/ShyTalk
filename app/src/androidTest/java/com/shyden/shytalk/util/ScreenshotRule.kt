package com.shyden.shytalk.util

import android.graphics.Bitmap
import android.util.Log
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.junit4.ComposeTestRule
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.test.captureToImage
import io.qameta.allure.kotlin.Allure
import org.junit.rules.TestWatcher
import org.junit.runner.Description
import java.io.ByteArrayInputStream
import java.io.ByteArrayOutputStream

/**
 * JUnit rule that captures a screenshot of the Compose tree on test failure
 * and attaches it to the Allure report.
 */
class ScreenshotRule(
    private val composeTestRule: ComposeTestRule
) : TestWatcher() {
    override fun failed(e: Throwable, description: Description) {
        try {
            val bitmap = composeTestRule.onRoot().captureToImage()
                .asAndroidBitmap()
            val stream = ByteArrayOutputStream()
            bitmap.compress(Bitmap.CompressFormat.PNG, 100, stream)
            val bytes = stream.toByteArray()
            val fileName = "${description.className}_${description.methodName}.png"
            Allure.attachment(
                name = fileName,
                content = ByteArrayInputStream(bytes),
                type = "image/png",
                fileExtension = ".png"
            )
            Log.d("ScreenshotRule", "Captured failure screenshot: $fileName (${bytes.size} bytes)")
        } catch (ex: Exception) {
            Log.w("ScreenshotRule", "Failed to capture screenshot on failure", ex)
        }
    }
}
