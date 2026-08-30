package com.shyden.shytalk.navigation

import kotlinx.coroutines.test.runTest
import kotlin.test.Test
import kotlin.test.assertEquals
import kotlin.test.assertFalse
import kotlin.test.assertTrue

/**
 * Contract tests for [PlatformNavCallbacks].
 * Verifies the interface can be implemented with a test double,
 * and that all callback signatures are correct.
 */
class PlatformNavCallbacksTest {
    /** Test double that records all calls for verification. */
    private class RecordingCallbacks : PlatformNavCallbacks {
        val fcmTokensSaved = mutableListOf<String>()
        val fcmTokensRemoved = mutableListOf<String>()
        var messageSyncStarted = false
        var messageSyncStopped = false
        var permissionsRequested = false
        var canDrawOverlaysResult = false
        val imagesPickedCallbacks = mutableListOf<(List<ByteArray>) -> Unit>()
        val stickerPickedCallbacks = mutableListOf<(ByteArray?) -> Unit>()
        val photoPickedCallbacks = mutableListOf<(ByteArray?) -> Unit>()
        val packagesPurchased = mutableListOf<String>()
        val subscriptionsPurchased = mutableListOf<String>()
        val encodedUrls = mutableListOf<String>()
        val decodedUrls = mutableListOf<String>()

        override fun saveFcmToken(userId: String) {
            fcmTokensSaved.add(userId)
        }

        override suspend fun removeFcmToken(userId: String) {
            fcmTokensRemoved.add(userId)
        }

        override fun startMessageSyncService() {
            messageSyncStarted = true
        }

        override fun stopMessageSyncService() {
            messageSyncStopped = true
        }

        override fun requestPermissions() {
            permissionsRequested = true
        }

        override fun canDrawOverlays(): Boolean = canDrawOverlaysResult

        override fun pickImages(
            maxCount: Int,
            onResult: (List<ByteArray>) -> Unit,
        ) {
            imagesPickedCallbacks.add(onResult)
        }

        override fun pickStickerImage(onResult: (ByteArray?) -> Unit) {
            stickerPickedCallbacks.add(onResult)
        }

        override fun pickAndCropPhoto(onResult: (ByteArray?) -> Unit) {
            photoPickedCallbacks.add(onResult)
        }

        override fun purchasePackage(productId: String) {
            packagesPurchased.add(productId)
        }

        override fun purchaseSubscription(productId: String) {
            subscriptionsPurchased.add(productId)
        }

        override fun encodeUrl(url: String): String {
            encodedUrls.add(url)
            return "encoded:$url"
        }

        override fun decodeUrl(encoded: String): String {
            decodedUrls.add(encoded)
            return "decoded:$encoded"
        }
    }

    @Test
    fun `saveFcmToken records userId`() {
        val cb = RecordingCallbacks()
        cb.saveFcmToken("user-123")
        assertEquals(listOf("user-123"), cb.fcmTokensSaved)
    }

    @Test
    fun `removeFcmToken records userId`() =
        runTest {
            // SHY-0494 made this suspend so callers must AWAIT the release
            // instead of firing it into a scope that sign-out then cancels.
            val cb = RecordingCallbacks()
            cb.removeFcmToken("user-456")
            assertEquals(listOf("user-456"), cb.fcmTokensRemoved)
        }

    @Test
    fun `startMessageSyncService sets flag`() {
        val cb = RecordingCallbacks()
        assertFalse(cb.messageSyncStarted)
        cb.startMessageSyncService()
        assertTrue(cb.messageSyncStarted)
    }

    @Test
    fun `stopMessageSyncService sets flag`() {
        val cb = RecordingCallbacks()
        assertFalse(cb.messageSyncStopped)
        cb.stopMessageSyncService()
        assertTrue(cb.messageSyncStopped)
    }

    @Test
    fun `requestPermissions sets flag`() {
        val cb = RecordingCallbacks()
        assertFalse(cb.permissionsRequested)
        cb.requestPermissions()
        assertTrue(cb.permissionsRequested)
    }

    @Test
    fun `canDrawOverlays returns configured value`() {
        val cb = RecordingCallbacks()
        assertFalse(cb.canDrawOverlays())
        cb.canDrawOverlaysResult = true
        assertTrue(cb.canDrawOverlays())
    }

    @Test
    fun `pickImages passes callback for result delivery`() {
        val cb = RecordingCallbacks()
        var received: List<ByteArray>? = null
        cb.pickImages(10) { received = it }
        assertEquals(1, cb.imagesPickedCallbacks.size)
        // Simulate platform delivering images
        cb.imagesPickedCallbacks[0](listOf(byteArrayOf(1, 2, 3)))
        assertEquals(1, received?.size)
    }

    @Test
    fun `pickStickerImage passes callback for result delivery`() {
        val cb = RecordingCallbacks()
        var received: ByteArray? = null
        cb.pickStickerImage { received = it }
        assertEquals(1, cb.stickerPickedCallbacks.size)
        cb.stickerPickedCallbacks[0](byteArrayOf(4, 5, 6))
        assertEquals(3, received?.size)
    }

    @Test
    fun `pickAndCropPhoto passes callback for result delivery`() {
        val cb = RecordingCallbacks()
        var received: ByteArray? = null
        cb.pickAndCropPhoto { received = it }
        assertEquals(1, cb.photoPickedCallbacks.size)
        cb.photoPickedCallbacks[0](byteArrayOf(7, 8))
        assertEquals(2, received?.size)
    }

    @Test
    fun `purchasePackage records productId`() {
        val cb = RecordingCallbacks()
        cb.purchasePackage("coins_500")
        assertEquals(listOf("coins_500"), cb.packagesPurchased)
    }

    @Test
    fun `purchaseSubscription records productId`() {
        val cb = RecordingCallbacks()
        cb.purchaseSubscription("supershy_monthly")
        assertEquals(listOf("supershy_monthly"), cb.subscriptionsPurchased)
    }

    @Test
    fun `encodeUrl returns encoded string and records input`() {
        val cb = RecordingCallbacks()
        val result = cb.encodeUrl("https://shytalk.com/path?q=1")
        assertEquals("encoded:https://shytalk.com/path?q=1", result)
        assertEquals(listOf("https://shytalk.com/path?q=1"), cb.encodedUrls)
    }

    @Test
    fun `decodeUrl returns decoded string and records input`() {
        val cb = RecordingCallbacks()
        val result = cb.decodeUrl("https%3A%2F%2Fshytalk.com")
        assertEquals("decoded:https%3A%2F%2Fshytalk.com", result)
        assertEquals(listOf("https%3A%2F%2Fshytalk.com"), cb.decodedUrls)
    }
}
