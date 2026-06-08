package com.shyden.shytalk.navigation

import org.junit.Assert.assertEquals
import org.junit.Assert.assertFalse
import org.junit.Assert.assertTrue
import org.junit.Test

/**
 * Tests for [AndroidPlatformNavCallbacks].
 *
 * Only tests non-composable, non-Firebase functionality.
 * FCM/service tests require Android context (covered by integration tests).
 * URL encoding uses android.net.Uri which is stubbed in unit tests.
 */
class AndroidPlatformNavCallbacksTest {
    @Test
    fun `canDrawOverlays returns false when no delegate provided`() {
        val callbacks =
            AndroidPlatformNavCallbacks(
                context = mockContext(),
                scope = kotlinx.coroutines.test.TestScope(),
                notificationRepository = FakeNotificationRepository(),
            )
        assertFalse(callbacks.canDrawOverlays())
    }

    @Test
    fun `canDrawOverlays delegates to provided lambda`() {
        var overlayResult = false
        val callbacks =
            AndroidPlatformNavCallbacks(
                context = mockContext(),
                scope = kotlinx.coroutines.test.TestScope(),
                notificationRepository = FakeNotificationRepository(),
                onCanDrawOverlays = { overlayResult },
            )
        assertFalse(callbacks.canDrawOverlays())
        overlayResult = true
        assertTrue(callbacks.canDrawOverlays())
    }

    @Test
    fun `requestPermissions delegates to provided lambda`() {
        var called = false
        val callbacks =
            AndroidPlatformNavCallbacks(
                context = mockContext(),
                scope = kotlinx.coroutines.test.TestScope(),
                notificationRepository = FakeNotificationRepository(),
                onRequestPermissions = { called = true },
            )
        callbacks.requestPermissions()
        assertTrue(called)
    }

    @Test
    fun `requestPermissions is safe when no delegate`() {
        val callbacks =
            AndroidPlatformNavCallbacks(
                context = mockContext(),
                scope = kotlinx.coroutines.test.TestScope(),
                notificationRepository = FakeNotificationRepository(),
            )
        // Should not throw
        callbacks.requestPermissions()
    }

    @Test
    fun `pickImages delegates maxCount and callback`() {
        var capturedMax = 0
        var capturedCallback: ((List<ByteArray>) -> Unit)? = null
        val callbacks =
            AndroidPlatformNavCallbacks(
                context = mockContext(),
                scope = kotlinx.coroutines.test.TestScope(),
                notificationRepository = FakeNotificationRepository(),
                onPickImagesRequest = { max, cb ->
                    capturedMax = max
                    capturedCallback = cb
                },
            )
        val resultHolder = mutableListOf<ByteArray>()
        callbacks.pickImages(5) { resultHolder.addAll(it) }
        assertEquals(5, capturedMax)
        // Simulate platform returning images
        capturedCallback?.invoke(listOf(byteArrayOf(1, 2, 3)))
        assertEquals(1, resultHolder.size)
    }

    @Test
    fun `pickStickerImage delegates callback`() {
        var capturedCallback: ((ByteArray?) -> Unit)? = null
        val callbacks =
            AndroidPlatformNavCallbacks(
                context = mockContext(),
                scope = kotlinx.coroutines.test.TestScope(),
                notificationRepository = FakeNotificationRepository(),
                onPickStickerRequest = { cb -> capturedCallback = cb },
            )
        var result: ByteArray? = null
        callbacks.pickStickerImage { result = it }
        capturedCallback?.invoke(byteArrayOf(4, 5))
        assertEquals(2, result?.size)
    }

    @Test
    fun `pickAndCropPhoto delegates callback`() {
        var capturedCallback: ((ByteArray?) -> Unit)? = null
        val callbacks =
            AndroidPlatformNavCallbacks(
                context = mockContext(),
                scope = kotlinx.coroutines.test.TestScope(),
                notificationRepository = FakeNotificationRepository(),
                onPickAndCropPhotoRequest = { cb -> capturedCallback = cb },
            )
        var result: ByteArray? = null
        callbacks.pickAndCropPhoto { result = it }
        capturedCallback?.invoke(byteArrayOf(6))
        assertEquals(1, result?.size)
    }

    @Test
    fun `purchasePackage delegates productId`() {
        var capturedId = ""
        val callbacks =
            AndroidPlatformNavCallbacks(
                context = mockContext(),
                scope = kotlinx.coroutines.test.TestScope(),
                notificationRepository = FakeNotificationRepository(),
                onPurchasePackageRequest = { capturedId = it },
            )
        callbacks.purchasePackage("coins_500")
        assertEquals("coins_500", capturedId)
    }

    @Test
    fun `purchaseSubscription delegates productId`() {
        var capturedId = ""
        val callbacks =
            AndroidPlatformNavCallbacks(
                context = mockContext(),
                scope = kotlinx.coroutines.test.TestScope(),
                notificationRepository = FakeNotificationRepository(),
                onPurchaseSubscriptionRequest = { capturedId = it },
            )
        callbacks.purchaseSubscription("supershy_monthly")
        assertEquals("supershy_monthly", capturedId)
    }

    // ── Helpers ──

    /** Returns a mock Android Context (JVM stubs return defaults). */
    private fun mockContext(): android.content.Context = android.app.Application()

    /**
     * Fake notification repository for testing.
     * FCM tests need real Firebase, so these are no-ops.
     */
    private class FakeNotificationRepository : com.shyden.shytalk.data.repository.NotificationRepository {
        override suspend fun saveFcmToken(
            userId: String,
            token: String,
        ) = com.shyden.shytalk.core.util.Resource
            .Success(Unit)

        override suspend fun removeFcmToken(
            userId: String,
            token: String,
        ) = com.shyden.shytalk.core.util.Resource
            .Success(Unit)

        override suspend fun setPmNotificationsEnabled(
            userId: String,
            enabled: Boolean,
        ) = com.shyden.shytalk.core.util.Resource
            .Success(Unit)

        override suspend fun getPmNotificationsEnabled(userId: String) =
            com.shyden.shytalk.core.util.Resource
                .Success(true)
    }
}
