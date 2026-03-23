package com.shyden.shytalk.core.crop

import android.app.Activity
import android.content.Intent
import android.net.Uri
import io.mockk.every
import io.mockk.mockk
import io.mockk.mockkStatic
import io.mockk.unmockkStatic
import org.junit.After
import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Before
import org.junit.Test

class CropContractTest {
    private val contract = CropContract()
    private val mockUri = mockk<Uri>()

    @Before
    fun setup() {
        mockkStatic(Uri::class)
        every { Uri.parse(any()) } returns mockUri
    }

    @After
    fun tearDown() {
        unmockkStatic(Uri::class)
    }

    // --- parseResult ---

    @Test
    fun `parseResult returns uri on RESULT_OK with valid uri`() {
        val intent = mockk<Intent>()
        every { intent.getStringExtra(CropActivity.EXTRA_RESULT_URI) } returns "file:///tmp/cropped.jpg"

        val result = contract.parseResult(Activity.RESULT_OK, intent)
        assertEquals(mockUri, result)
    }

    @Test
    fun `parseResult returns null on RESULT_CANCELED`() {
        val intent = mockk<Intent>()
        every { intent.getStringExtra(CropActivity.EXTRA_RESULT_URI) } returns "file:///tmp/cropped.jpg"

        assertNull(contract.parseResult(Activity.RESULT_CANCELED, intent))
    }

    @Test
    fun `parseResult returns null when intent is null`() {
        assertNull(contract.parseResult(Activity.RESULT_OK, null))
    }

    @Test
    fun `parseResult returns null when intent has no uri extra`() {
        val intent = mockk<Intent>()
        every { intent.getStringExtra(CropActivity.EXTRA_RESULT_URI) } returns null

        assertNull(contract.parseResult(Activity.RESULT_OK, intent))
    }

    // --- CropInput defaults ---

    @Test
    fun `CropInput has correct defaults`() {
        val input = CropInput(uri = mockUri, aspectRatioX = 1, aspectRatioY = 1)
        assertEquals("rectangle", input.cropShape)
        assertEquals(80, input.quality)
        assertEquals("Crop", input.title)
    }

    @Test
    fun `CropInput preserves custom values`() {
        val input =
            CropInput(
                uri = mockUri,
                aspectRatioX = 16,
                aspectRatioY = 9,
                cropShape = "oval",
                quality = 95,
                title = "Edit Cover",
            )
        assertEquals(mockUri, input.uri)
        assertEquals(16, input.aspectRatioX)
        assertEquals(9, input.aspectRatioY)
        assertEquals("oval", input.cropShape)
        assertEquals(95, input.quality)
        assertEquals("Edit Cover", input.title)
    }
}
